package dev.interrobang.pray

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.ConcurrentHashMap

/** 앱 화면이 지금 보고 있는 PC (앞에 있을 때만, 아니면 null). 같은 PC 의 알림은 화면 배지로 보이니 띄우지 않는다 */
object AppState {
    @Volatile
    var visibleMachineName: String? = null
}

/**
 * 포그라운드 서비스(specialUse). 저장한 Pray PC 마다 StreamWorker 하나로 알림 SSE 를 붙들고, 받은 notice 를 안드로이드 알림으로 띄운다.
 * 상시 알림 "Connected · 1-home, 2-office". 10분마다 PC 목록을 다시 받는다. 앱을 열면 시작된다 (부팅 뒤 자동 시작 없음)
 */
class NotifyService : Service(), StreamWorker.Listener {
    private val handler = Handler(Looper.getMainLooper())
    private val workers = HashMap<String, StreamWorker>()
    private val states = ConcurrentHashMap<String, StreamState>()
    private lateinit var store: MachineStore
    private lateinit var connectivity: ConnectivityManager
    private var lastNetwork: Network? = null
    private var hasSeenNetwork = false
    @Volatile
    private var isRefreshing = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post {
                val isChanged = network != lastNetwork
                lastNetwork = network
                // 등록하자마자 오는 첫 onAvailable 은 지금 네트워크라 건너뛴다
                if (isChanged && hasSeenNetwork) workers.values.forEach { it.reconnect() }
                hasSeenNetwork = true
            }
        }

        override fun onLost(network: Network) {
            handler.post { if (network == lastNetwork) lastNetwork = null }
        }
    }

    private val refreshTask = object : Runnable {
        override fun run() {
            refreshMachines()
            handler.postDelayed(this, REFRESH_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        store = MachineStore(this)
        createChannels(this)
        connectivity = getSystemService(ConnectivityManager::class.java)
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback)
        } catch (error: RuntimeException) {
            // 콜백 수 제한 등. 없어도 지수 간격으로 다시 붙는다
        }
        handler.postDelayed(refreshTask, REFRESH_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForegroundService 마다 5초 안에 불러야 한다
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NoticeText.ONGOING_NOTIFICATION_ID, ongoingNotification(), type)
        reconcile()
        // 앱을 열었다: 기다리던 PC(끊김·404·401)를 바로 다시 본다
        if (intent?.action == ACTION_RELOAD) workers.values.forEach { it.wake() }
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try {
            connectivity.unregisterNetworkCallback(networkCallback)
        } catch (error: RuntimeException) {
            // 등록 실패했던 것
        }
        workers.values.forEach { it.shutdown() }
        workers.clear()
        super.onDestroy()
    }

    /** 저장 목록에 맞춰 스레드를 늘리고 줄인다 (주소가 바뀐 PC 는 새로). 목록이 비면 서비스를 끈다 */
    private fun reconcile() {
        val machines = store.machines
        if (machines.isEmpty()) {
            stopSelf()
            return
        }
        val wanted = machines.associateBy { it.name }
        workers.entries.removeAll { (name, worker) ->
            val isGone = wanted[name] != worker.machine
            if (isGone) {
                worker.shutdown()
                states.remove(name)
            }
            isGone
        }
        machines.filter { it.name !in workers }.forEach { machine ->
            states[machine.name] = StreamState.DISCONNECTED
            workers[machine.name] = StreamWorker(machine, this).also { it.isDaemon = true; it.start() }
        }
        updateOngoing()
    }

    private fun refreshMachines() {
        if (isRefreshing) return
        isRefreshing = true
        Thread {
            try {
                if (PrayHttp.refreshMachines(store)) handler.post { reconcile() }
            } finally {
                isRefreshing = false
            }
        }.apply { isDaemon = true }.start()
    }

    override fun onState(machine: Machine, state: StreamState) {
        handler.post {
            if (workers[machine.name]?.machine != machine) return@post
            if (states.put(machine.name, state) != state) updateOngoing()
        }
    }

    override fun onNotice(machine: Machine, notice: Notice) {
        if (AppState.visibleMachineName == machine.name) return
        val id = NoticeText.notificationId(machine.name, notice)
        val open = PendingIntent.getActivity(
            this,
            id,
            MainActivity.openIntent(this, NoticeText.openUrl(machine, notice.sessionId)),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val channel = NoticeText.channelFor(notice.kind)
        val notification = NotificationCompat.Builder(this, channel.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(this, R.color.logo_accent))
            .setContentTitle(NoticeText.title(machine.name, notice))
            .setContentText(notice.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notice.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setWhen(notice.atMillis ?: System.currentTimeMillis())
            .setShowWhen(true)
            .setCategory(if (notice.kind == "reminder") NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_STATUS)
            .setPriority(if (channel == NoticeChannel.TURN) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            .build()
        post(id, notification)
    }

    private fun updateOngoing() {
        post(NoticeText.ONGOING_NOTIFICATION_ID, ongoingNotification())
    }

    private fun ongoingNotification(): Notification {
        val names = store.machines.map { it.name }.toSet()
        val (title, text) = NoticeText.ongoing(states.filterKeys { it in names })
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, NoticeChannel.SERVICE.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun post(id: Int, notification: Notification) {
        val manager = NotificationManagerCompat.from(this)
        if (!manager.areNotificationsEnabled()) return
        try {
            manager.notify(id, notification)
        } catch (error: SecurityException) {
            // 알림 권한 없음
        }
    }

    companion object {
        const val ACTION_RELOAD = "dev.interrobang.pray.RELOAD"
        private const val REFRESH_MS = 10 * 60_000L

        /** 저장한 PC 가 있으면 서비스를 띄우고(이미 떠 있으면) 목록을 다시 읽게 한다. 앱이 앞에 있을 때만 부른다 */
        fun start(context: Context) {
            if (MachineStore(context).machines.isEmpty()) return
            val intent = Intent(context, NotifyService::class.java).setAction(ACTION_RELOAD)
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (error: RuntimeException) {
                // 뒤에 있을 때 막힘(ForegroundServiceStartNotAllowedException) 등. 다음에 앱을 열면 다시
            }
        }

        fun createChannels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            val channels = NoticeChannel.entries.map { channel ->
                val importance = when (channel) {
                    NoticeChannel.SERVICE -> NotificationManager.IMPORTANCE_LOW
                    NoticeChannel.TURN -> NotificationManager.IMPORTANCE_DEFAULT
                    else -> NotificationManager.IMPORTANCE_HIGH
                }
                NotificationChannel(channel.id, channel.label, importance).apply {
                    if (channel == NoticeChannel.SERVICE) {
                        setSound(null, null)
                        enableVibration(false)
                        setShowBadge(false)
                    }
                }
            }
            manager.createNotificationChannels(channels)
        }
    }
}
