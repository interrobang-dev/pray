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
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.File

/**
 * 앱을 새로 열면 늘 랜딩(Tailscale 상태·PC 카드, LandingScreen.kt). 카드를 누르면 전체 화면 WebView 로 Pray 웹을 띄운다.
 * 알림을 누르면 랜딩을 건너뛰고 그 세션으로. 저장한 PC 주소는 앱 안, 그 밖은 폰 브라우저. 못 붙으면 "Can't reach <name>" + Retry + 다른 PC
 */
class MainActivity : ComponentActivity() {
    private lateinit var store: MachineStore
    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private lateinit var setupView: View
    private lateinit var errorView: View
    private lateinit var landingView: View
    private lateinit var landing: LandingScreen

    private var screen = Screen.LANDING

    /** 다음에 끝나는 PC 페이지에서 WebView 기록을 지운다 (랜딩·알림에서 연 PC 에서 뒤로 가면 랜딩이지, 전에 본 PC·about:blank 가 아니게) */
    private var shouldClearHistory = false

    /** WebView 가 보고 있는(또는 열려는) PC */
    private var currentMachine: Machine? = null
    private var isResumedNow = false
    private var hasMainFrameError = false
    private var lastRefreshAt = 0L

    /** 이번 손짓에 페이지가 알린 "당겨 새로고침을 막을지" (브리지 스레드가 쓴다). null = 아직 안 옴 → 막는다 (→ PullRefresh.kt) */
    @Volatile private var pageBlocksPull: Boolean? = null
    private var isDispatchingDown = false

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
        refresh = findViewById(R.id.refresh)
        setupView = findViewById(R.id.setup)
        errorView = findViewById(R.id.error)
        landingView = findViewById(R.id.landing)
        landing = LandingScreen(
            this,
            store,
            onOpen = { openMachine(it) },
            onAddPc = { showSetup(prefill = "") },
            onMachinesChanged = { NotifyService.start(this) },
        )
        setupWebView()
        setupPullRefresh()
        setupSetupScreen()
        findViewById<Button>(R.id.error_retry).setOnClickListener { currentMachine?.let { openMachine(it) } }
        findViewById<Button>(R.id.error_change_address).setOnClickListener { showSetup(prefill = currentMachine?.url) }

        onBackPressedDispatcher.addCallback(this) {
            when (Landing.back(screen, errorView.visibility == View.VISIBLE, web.canGoBack())) {
                BackAction.WEB_BACK -> web.goBack()
                BackAction.TO_LANDING -> showLanding()
                BackAction.CLOSE -> finish()
                BackAction.NONE -> Unit
            }
        }

        // 새로 열면 랜딩. 알림이 넘긴 주소면 그 세션으로 바로. 시스템이 뒤에서 화면을 지웠다 되살린 것이면 보던 웹 주소로
        val requestedUrl = takeRequestedUrl(intent)
        val restoredUrl = savedInstanceState?.getString(STATE_WEB_URL)
        when {
            requestedUrl != null -> openUrl(requestedUrl)
            restoredUrl != null -> openUrl(restoredUrl)
            else -> showLanding()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val url = web.url
        if (screen == Screen.WEB && url != null && url != BLANK_URL) outState.putString(STATE_WEB_URL, url)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeRequestedUrl(intent)?.let { openUrl(it) }
    }

    override fun onStart() {
        super.onStart()
        if (store.machines.isEmpty()) return
        NotifyService.start(this)
        // 랜딩은 보일 때마다 스스로 목록을 다시 받는다
        if (screen != Screen.LANDING) refreshMachinesIfStale()
    }

    override fun onResume() {
        super.onResume()
        isResumedNow = true
        updateVisibleMachine()
        if (screen == Screen.LANDING) landing.start()
    }

    override fun onPause() {
        isResumedNow = false
        landing.stop()
        AppState.visibleMachineName = null
        CookieManager.getInstance().flush()
        super.onPause()
    }

    /** 손가락을 대면 지난 손짓의 페이지 답을 지운다. DOWN 을 넘기는 동안은 SwipeRefreshLayout 이 시작 위치를 잡게 막지 않는다 */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked != MotionEvent.ACTION_DOWN) return super.dispatchTouchEvent(event)
        pageBlocksPull = null
        isDispatchingDown = true
        try {
            return super.dispatchTouchEvent(event)
        } finally {
            isDispatchingDown = false
        }
    }

    /**
     * 뒤로 키는 화면(WebView 포함)을 거치지 않고 바로 이 Activity 의 onKeyDown·onKeyLongPress·onKeyUp 으로 보낸다.
     * Activity.dispatchKeyEvent 와 같은 DispatcherState 를 써서 길게 누르기 판정·손 뗄 때 취소 표시가 그대로 된다
     */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
        return event.dispatch(this, window.decorView.keyDispatcherState, this)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyDown(keyCode, event)
        event.startTracking()
        return true
    }

    /** 길게 누르면 바로 랜딩. 랜딩에서도 true — 그래야 손을 뗄 때 오는 UP 이 취소로 표시돼 짧은 뒤로(앱 닫기)가 돌지 않는다 */
    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyLongPress(keyCode, event)
        if (Landing.longBack(screen) == BackAction.TO_LANDING) showLanding()
        return true
    }

    /** 짧게 눌렀다 뗐을 때만 지금의 뒤로 (길게 누른 뒤의 UP 은 isCanceled) */
    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode != KeyEvent.KEYCODE_BACK) return super.onKeyUp(keyCode, event)
        if (event.isTracking && !event.isCanceled) onBackPressedDispatcher.onBackPressed()
        return true
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
                refresh.isRefreshing = false
                if (url == BLANK_URL) return
                if (shouldClearHistory) {
                    shouldClearHistory = false
                    view.clearHistory()
                }
                // 당기기 판정 스크립트는 저장한 PC 페이지에만 넣는다
                if (Machines.machineFor(url, store.machines) != null) view.evaluateJavascript(PullRefresh.SCRIPT, null)
                if (hasMainFrameError || screen != Screen.WEB) return
                errorView.visibility = View.GONE
                web.visibility = View.VISIBLE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // 랜딩으로 나가며 멈춘 페이지의 오류는 보이지 않는다
                if (!request.isForMainFrame || screen != Screen.WEB) return
                hasMainFrameError = true
                refresh.isRefreshing = false
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

    /**
     * 맨 위에서 당기면 web.reload(), onPageFinished·onReceivedError 에서 스피너를 멈춘다.
     * Pray 웹은 안쪽 요소가 스크롤돼서 페이지 스크립트가 알린 값으로 막는다 (→ PullRefresh.kt).
     * 브리지는 boolean 하나만 받아 당기기를 막을지만 바꾼다 — 다른 출처 페이지가 불러도 해가 없다
     */
    @SuppressLint("JavascriptInterface")
    private fun setupPullRefresh() {
        refresh.setColorSchemeResources(R.color.logo_accent)
        refresh.setProgressBackgroundColorSchemeResource(R.color.logo_background)
        refresh.setOnRefreshListener { web.reload() }
        refresh.setOnChildScrollUpCallback { _, _ ->
            PullRefresh.isBlocked(web.visibility == View.VISIBLE, isDispatchingDown, pageBlocksPull, web.canScrollVertically(-1))
        }
        web.addJavascriptInterface(PullBridge(), PullRefresh.BRIDGE_NAME)
    }

    private inner class PullBridge {
        @JavascriptInterface
        fun report(blocked: Boolean) {
            pageBlocksPull = blocked
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

    /** 랜딩: 웹 페이지는 about:blank 로 멈춘다 (뒤에서 SSE·폴링을 붙들지 않고, 다른 PC 를 열 때 옛 화면이 비치지 않게) */
    private fun showLanding() {
        screen = Screen.LANDING
        setupView.visibility = View.GONE
        errorView.visibility = View.GONE
        web.visibility = View.INVISIBLE
        refresh.isRefreshing = false
        landingView.visibility = View.VISIBLE
        web.stopLoading()
        web.loadUrl(BLANK_URL)
        updateVisibleMachine()
        if (isResumedNow) landing.start()
    }

    /** 주소 입력 (Add PC·"Use another address"). prefill null 이면 입력칸을 그대로 둔다 */
    private fun showSetup(prefill: String?) {
        screen = Screen.SETUP
        landing.stop()
        landingView.visibility = View.GONE
        errorView.visibility = View.GONE
        setupView.visibility = View.VISIBLE
        setSetupMessage(null)
        findViewById<EditText>(R.id.setup_address).apply {
            if (prefill != null) setText(prefill)
        }
        updateVisibleMachine()
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
        screen = Screen.WEB
        landing.stop()
        landingView.visibility = View.GONE
        shouldClearHistory = true
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
        AppState.visibleMachineName = if (isResumedNow && screen == Screen.WEB) currentMachine?.name else null
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
                // Add PC: 이미 있던 PC 도 아는 PC 로 넘겨 남긴다
                val machines = Machines.merge(store.machines + entered, result.listed)
                val self = result.listed.firstOrNull { it.isSelf }?.name
                store.machines = machines
                val first = machines.firstOrNull { it.name == self } ?: machines.firstOrNull { it.name == entered.name } ?: machines.first()
                lastRefreshAt = System.currentTimeMillis()
                openMachine(first)
                NotifyService.start(this)
            }
            // 메일 로그인이 필요한 PC (같은 Tailscale 계정이 아님): 그 PC 하나로 열어 웹 로그인 화면을 따른다
            is MachinesResult.HttpError -> if (result.code == 401) {
                store.machines = Landing.sorted(store.machines.filter { it.name != entered.name } + entered)
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
        private const val STATE_WEB_URL = "webUrl"
        private const val BLANK_URL = "about:blank"

        /** 알림을 누르면 열 화면: 그 주소를 앱 안에서 */
        fun openIntent(context: Context, url: String): Intent =
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
