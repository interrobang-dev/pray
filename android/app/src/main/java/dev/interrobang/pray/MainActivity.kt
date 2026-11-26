package dev.interrobang.pray

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File

/**
 * 전체 화면 WebView 로 Pray 웹을 띄운다. 첫 실행이면 PC 주소 입력 화면, 그 뒤로는 마지막에 본 PC.
 * 저장한 PC 주소는 앱 안, 그 밖은 폰 브라우저. 못 붙으면 "Can't reach <name>" + Retry + 다른 PC
 */
class MainActivity : ComponentActivity() {
    private lateinit var store: MachineStore
    private lateinit var web: WebView
    private lateinit var setupView: View
    private lateinit var errorView: View

    /** WebView 가 보고 있는(또는 열려는) PC */
    private var currentMachine: Machine? = null
    private var isResumedNow = false
    private var hasMainFrameError = false
    private var lastRefreshAt = 0L

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var cameraFile: File? = null

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        callback.onReceiveValue(chosenUris(result.resultCode, result.data))
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        askBatteryOptimizationOnce()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = MachineStore(this)
        setContentView(R.layout.activity_main)
        setupEdgeToEdge()
        web = findViewById(R.id.web)
        setupView = findViewById(R.id.setup)
        errorView = findViewById(R.id.error)
        setupWebView()
        setupSetupScreen()
        findViewById<Button>(R.id.error_retry).setOnClickListener { currentMachine?.let { openMachine(it) } }
        findViewById<Button>(R.id.error_change_address).setOnClickListener { showSetup() }

        onBackPressedDispatcher.addCallback(this) {
            if (web.visibility == View.VISIBLE && errorView.visibility != View.VISIBLE && setupView.visibility != View.VISIBLE && web.canGoBack()) {
                web.goBack()
            } else {
                finish()
            }
        }

        val requestedUrl = takeRequestedUrl(intent)
        val last = store.lastMachine()
        when {
            requestedUrl != null -> openUrl(requestedUrl)
            last != null -> openMachine(last)
            else -> showSetup()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeRequestedUrl(intent)?.let { openUrl(it) }
    }

    override fun onStart() {
        super.onStart()
        if (store.machines.isEmpty()) return
        NotifyService.start(this)
        refreshMachinesIfStale()
    }

    override fun onResume() {
        super.onResume()
        isResumedNow = true
        updateVisibleMachine()
    }

    override fun onPause() {
        isResumedNow = false
        AppState.visibleMachineName = null
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        web.destroy()
        super.onDestroy()
    }

    // ── 화면 ──

    /** targetSdk 35 는 화면이 상태 표시줄·내비 막대 밑까지 그려진다. 그 높이와 키보드 높이만큼 안쪽 여백을 줘서 웹의 100dvh 가 남는 칸이 되게 */
    private fun setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = findViewById<View>(R.id.root)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        CookieManager.getInstance().setAcceptCookie(true)
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (Machines.linkTarget(url, store.machines) == LinkTarget.IN_APP) return false
                openOutside(url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                hasMainFrameError = false
                noteUrl(url)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                noteUrl(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (hasMainFrameError) return
                errorView.visibility = View.GONE
                web.visibility = View.VISIBLE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                hasMainFrameError = true
                showError(Machines.machineFor(request.url.toString(), store.machines) ?: currentMachine, error.description?.toString())
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileChooser.launch(chooserIntent(params))
                    true
                } catch (error: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    private fun setupSetupScreen() {
        val address = findViewById<EditText>(R.id.setup_address)
        val connect = findViewById<Button>(R.id.setup_connect)
        connect.setOnClickListener { connectTo(address.text.toString()) }
        address.setOnEditorActionListener { _, actionId, _ ->
            if (actionId != EditorInfo.IME_ACTION_GO) return@setOnEditorActionListener false
            connectTo(address.text.toString())
            true
        }
    }

    private fun showSetup() {
        errorView.visibility = View.GONE
        setupView.visibility = View.VISIBLE
        findViewById<EditText>(R.id.setup_address).apply {
            if (text.isEmpty()) setText(currentMachine?.url ?: "")
        }
    }

    private fun setSetupMessage(message: String?) {
        findViewById<TextView>(R.id.setup_message).apply {
            text = message ?: ""
            visibility = if (message == null) View.GONE else View.VISIBLE
        }
    }

    private fun showError(machine: Machine?, detail: String?) {
        val name = machine?.name ?: "PC"
        findViewById<TextView>(R.id.error_title).text = "Can't reach $name"
        findViewById<TextView>(R.id.error_detail).text = detail ?: ""
        val others = store.machines.filter { it.name != machine?.name }
        val list = findViewById<LinearLayout>(R.id.error_others)
        list.removeAllViews()
        others.forEach { other ->
            list.addView(Button(this).apply {
                text = other.name
                isAllCaps = false
                setOnClickListener { openMachine(other) }
            })
        }
        findViewById<View>(R.id.error_others_label).visibility = if (others.isEmpty()) View.GONE else View.VISIBLE
        setupView.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    // ── 열기 ──

    private fun openMachine(machine: Machine) {
        openUrl("${machine.url}/")
    }

    private fun openUrl(url: String) {
        noteUrl(url)
        setupView.visibility = View.GONE
        errorView.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(url)
        askPermissionsOnce()
    }

    /** WebView 가 옮겨 간 주소가 저장한 PC 면 지금 PC·마지막에 본 PC 로 둔다 (웹의 PC 칩으로 옮겨 가도 따라간다) */
    private fun noteUrl(url: String) {
        val machine = Machines.machineFor(url, store.machines) ?: return
        currentMachine = machine
        store.lastMachineName = machine.name
        updateVisibleMachine()
    }

    private fun updateVisibleMachine() {
        AppState.visibleMachineName = if (isResumedNow) currentMachine?.name else null
    }

    private fun openOutside(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (error: ActivityNotFoundException) {
            // 열 앱이 없다
        }
    }

    /** 알림이 넘긴 주소. 한 번 읽으면 지워 화면을 다시 만들 때 또 열지 않는다 */
    private fun takeRequestedUrl(intent: Intent?): String? {
        val url = intent?.getStringExtra(EXTRA_URL) ?: return null
        intent.removeExtra(EXTRA_URL)
        return url
    }

    // ── 첫 실행: 주소 → /api/machines ──

    private fun connectTo(input: String) {
        val address = Machines.normalizeAddress(input)
        if (address == null) {
            setSetupMessage("Enter an address like http://2-office:4710")
            return
        }
        setSetupMessage(null)
        val connect = findViewById<Button>(R.id.setup_connect)
        connect.isEnabled = false
        connect.text = "Connecting…"
        Thread {
            val result = PrayHttp.fetchMachines(address)
            runOnUiThread {
                connect.isEnabled = true
                connect.text = "Connect"
                onSetupResult(address, result)
            }
        }.apply { isDaemon = true }.start()
    }

    private fun onSetupResult(address: String, result: MachinesResult) {
        val entered = Machine(Machines.nameOf(address), address)
        when (result) {
            is MachinesResult.Ok -> {
                val machines = Machines.merge(listOf(entered), result.listed)
                val self = result.listed.firstOrNull { it.isSelf }?.name
                store.machines = machines
                val first = machines.firstOrNull { it.name == self } ?: machines.firstOrNull { it.name == entered.name } ?: machines.first()
                lastRefreshAt = System.currentTimeMillis()
                openMachine(first)
                NotifyService.start(this)
            }
            // 메일 로그인이 필요한 PC (같은 Tailscale 계정이 아님): 그 PC 하나로 열어 웹 로그인 화면을 따른다
            is MachinesResult.HttpError -> if (result.code == 401) {
                store.machines = listOf(entered)
                openMachine(entered)
                NotifyService.start(this)
            } else {
                setSetupMessage("Can't reach ${entered.name} (HTTP ${result.code})")
            }
            is MachinesResult.Failed -> setSetupMessage("Can't reach ${entered.name} · ${result.message}")
        }
    }

    /** 앱을 열 때 PC 목록을 다시 받는다 (1분 안에 받았으면 건너뛴다). 바뀌면 서비스가 다시 읽는다 */
    private fun refreshMachinesIfStale() {
        val now = System.currentTimeMillis()
        if (now - lastRefreshAt < 60_000) return
        lastRefreshAt = now
        val appContext = applicationContext
        Thread {
            if (PrayHttp.refreshMachines(store)) runOnUiThread { NotifyService.start(appContext) }
        }.apply { isDaemon = true }.start()
    }

    // ── 권한 (처음 한 번) ──

    private fun askPermissionsOnce() {
        if (store.hasAskedPermissions) return
        store.hasAskedPermissions = true
        val needsNotificationPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsNotificationPermission) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            askBatteryOptimizationOnce()
        }
    }

    /** 삼성은 배터리 최적화에서 빼지 않으면 서비스를 끈다 */
    @SuppressLint("BatteryLife")
    private fun askBatteryOptimizationOnce() {
        val power = getSystemService(PowerManager::class.java)
        if (power.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (error: ActivityNotFoundException) {
            // 그 화면이 없는 기기
        }
    }

    // ── 첨부 고르기 (사진·카메라) ──

    private fun chooserIntent(params: WebChromeClient.FileChooserParams): Intent {
        val content = params.createIntent().apply {
            if (params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        val camera = cameraIntent()
        return Intent.createChooser(content, null).apply {
            if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        }
    }

    private fun cameraIntent(): Intent? {
        val folder = File(cacheDir, "camera").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = File(folder, "photo-${System.currentTimeMillis()}.jpg")
        val uri = try {
            FileProvider.getUriForFile(this, "$packageName.files", file)
        } catch (error: IllegalArgumentException) {
            return null
        }
        cameraFile = file
        cameraUri = uri
        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("", uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun chosenUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK) return null
        val clip = data?.clipData
        if (clip != null && clip.itemCount > 0) return Array(clip.itemCount) { clip.getItemAt(it).uri }
        data?.data?.let { return arrayOf(it) }
        // 카메라는 data 없이 EXTRA_OUTPUT 파일에 쓴다
        val file = cameraFile
        val uri = cameraUri
        if (file != null && uri != null && file.length() > 0) return arrayOf(uri)
        return null
    }

    companion object {
        private const val EXTRA_URL = "dev.interrobang.pray.URL"

        /** 알림을 누르면 열 화면: 그 주소를 앱 안에서 */
        fun openIntent(context: Context, url: String): Intent =
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
