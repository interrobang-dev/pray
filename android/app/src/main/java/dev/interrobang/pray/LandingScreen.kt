package dev.interrobang.pray

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * 랜딩 화면 (activity_main.xml 의 `landing`): Tailscale 상태 · PC 카드(Pray 응답·알림 연결·마지막에 본 PC) · Add PC.
 * 보이는 동안([start]~[stop])만 확인하고 네트워크·알림 상태 변화를 따라 다시 그린다. 판정·글자는 [Landing]
 */
class LandingScreen(
    private val activity: Activity,
    private val store: MachineStore,
    private val onOpen: (Machine) -> Unit,
    private val onAddPc: () -> Unit,
    private val onMachinesChanged: () -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val connectivity = activity.getSystemService(ConnectivityManager::class.java)
    private val refresh = activity.findViewById<SwipeRefreshLayout>(R.id.landing)
    private val list = activity.findViewById<LinearLayout>(R.id.landing_machines)
    private val tailscaleButton = activity.findViewById<Button>(R.id.landing_tailscale_open)

    /** PC 이름 → 이번 확인 결과. 확인을 다시 하면 새 회차(generation)가 되어 늦게 온 옛 답은 버린다 */
    private val probes = HashMap<String, ProbeState>()
    private var generation = 0
    private var isActive = false
    private var isVpnOn = false
    private var lastNetwork: Network? = null

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post { onNetworkChanged() }
        }

        override fun onLost(network: Network) {
            handler.post { onNetworkChanged() }
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            handler.post { onNetworkChanged() }
        }
    }

    init {
        refresh.setColorSchemeResources(R.color.logo_accent)
        refresh.setProgressBackgroundColorSchemeResource(R.color.logo_background)
        refresh.setOnRefreshListener { check() }
        activity.findViewById<Button>(R.id.landing_reload).setOnClickListener { check() }
        activity.findViewById<Button>(R.id.landing_add).setOnClickListener { onAddPc() }
        tailscaleButton.setOnClickListener { openTailscale() }
    }

    /** 보이기 시작 (랜딩으로 오거나 앱이 앞으로 왔을 때). 이미 보이고 있어도 다시 확인한다 */
    fun start() {
        if (!isActive) {
            isActive = true
            lastNetwork = connectivity.activeNetwork
            isVpnOn = readVpn()
            try {
                connectivity.registerDefaultNetworkCallback(networkCallback)
            } catch (error: RuntimeException) {
                // 콜백 수 제한 등. ↻·당기기로 다시 본다
            }
            AppState.onStreamStatesChanged = { if (isActive) render() }
        }
        check()
    }

    fun stop() {
        if (!isActive) return
        isActive = false
        generation++
        handler.removeCallbacksAndMessages(null)
        refresh.isRefreshing = false
        try {
            connectivity.unregisterNetworkCallback(networkCallback)
        } catch (error: RuntimeException) {
            // 등록 실패했던 것
        }
        AppState.onStreamStatesChanged = null
    }

    /** 모든 PC 에 Pray 가 답하는지 동시에 묻고, PC 목록도 다시 받는다 */
    private fun check() {
        if (!isActive) return
        val round = ++generation
        isVpnOn = readVpn()
        probes.clear()
        val machines = store.machines
        machines.forEach { probes[it.name] = ProbeState.CHECKING }
        refresh.isRefreshing = machines.isNotEmpty()
        render()
        machines.forEach { probe(it, round) }
        // DNS 찾기는 연결 제한에 안 든다 — 정한 시간 안에 못 들은 PC 는 "No answer" 로 두고, 늦게 답하면 그때 고친다
        handler.postDelayed({
            if (round != generation) return@postDelayed
            probes.replaceAll { _, state -> if (state == ProbeState.CHECKING) ProbeState.NO_ANSWER else state }
            refresh.isRefreshing = false
            render()
        }, PROBE_DEADLINE_MS)
        Thread {
            if (!PrayHttp.refreshMachines(store)) return@Thread
            handler.post {
                if (round != generation) return@post
                onMachinesChanged()
                // 새로 생긴 PC 만 묻는다
                store.machines.filter { it.name !in probes }.forEach {
                    probes[it.name] = ProbeState.CHECKING
                    probe(it, round)
                }
                render()
            }
        }.apply { isDaemon = true }.start()
    }

    private fun probe(machine: Machine, round: Int) {
        Thread {
            val state = if (PrayHttp.probe(machine.url)) ProbeState.ANSWERS else ProbeState.NO_ANSWER
            handler.post {
                if (round != generation || machine.name !in probes) return@post
                probes[machine.name] = state
                if (probes.values.none { it == ProbeState.CHECKING }) refresh.isRefreshing = false
                render()
            }
        }.apply { isDaemon = true }.start()
    }

    /** 기본 네트워크가 바뀌었거나 VPN 이 켜지고 꺼지면 다시 확인. 신호 세기 같은 다른 capability 변화는 넘긴다 */
    private fun onNetworkChanged() {
        if (!isActive) return
        val network = connectivity.activeNetwork
        val vpn = readVpn()
        if (network == lastNetwork && vpn == isVpnOn) return
        lastNetwork = network
        check()
    }

    /** 기본 네트워크가 VPN 이거나 VPN 네트워크가 하나라도 있다 (Tailscale 이 tailnet 주소만 받는 경우 기본 네트워크가 VPN 이 아닐 수 있어 둘 다 본다) */
    private fun readVpn(): Boolean {
        val active = connectivity.activeNetwork
        if (active != null && connectivity.getNetworkCapabilities(active)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true) return true
        @Suppress("DEPRECATION")
        return connectivity.allNetworks.any { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }

    private fun render() {
        val machines = Landing.sorted(store.machines)
        val banner = Landing.banner(isVpnOn, machines.mapNotNull { probes[it.name] })
        activity.findViewById<TextView>(R.id.landing_tailscale_title).text = banner.title
        activity.findViewById<TextView>(R.id.landing_tailscale_detail).apply {
            text = banner.detail ?: ""
            visibility = if (banner.detail == null) View.GONE else View.VISIBLE
        }
        activity.findViewById<TextView>(R.id.landing_tailscale_dot).apply {
            text = if (banner == TailscaleBanner.CONNECTED) "●" else "○"
            setTextColor(color(if (banner == TailscaleBanner.CONNECTED) R.color.landing_ok else R.color.landing_warn))
        }
        tailscaleButton.visibility = if (banner.hasButton) View.VISIBLE else View.GONE
        tailscaleButton.text = Landing.tailscaleButtonLabel(tailscaleLaunchIntent() != null)

        activity.findViewById<View>(R.id.landing_empty).visibility = if (machines.isEmpty()) View.VISIBLE else View.GONE
        val streams = AppState.streamStates
        val lastName = store.lastMachineName
        list.removeAllViews()
        val inflater = LayoutInflater.from(activity)
        machines.forEach { machine ->
            val probe = probes[machine.name] ?: ProbeState.CHECKING
            val card = inflater.inflate(R.layout.landing_machine, list, false)
            card.findViewById<TextView>(R.id.machine_name).text = machine.name
            card.findViewById<TextView>(R.id.machine_host).text = Landing.subtitle(machine)
            card.findViewById<TextView>(R.id.machine_status).text = Landing.statusLine(probe, streams[machine.name])
            card.findViewById<TextView>(R.id.machine_dot).apply {
                text = Landing.dot(probe)
                setTextColor(color(if (probe == ProbeState.ANSWERS) R.color.landing_ok else R.color.landing_text_secondary))
            }
            card.findViewById<View>(R.id.machine_last).visibility = if (machine.name == lastName) View.VISIBLE else View.GONE
            // 답하지 않는 PC 도 연다 (Tailscale 이 늦게 잡힐 수 있다). 못 붙으면 "Can't reach" 화면
            card.setOnClickListener { onOpen(machine) }
            list.addView(card)
        }
    }

    private fun color(id: Int): Int = ContextCompat.getColor(activity, id)

    private fun tailscaleLaunchIntent(): Intent? = activity.packageManager.getLaunchIntentForPackage(Landing.TAILSCALE_PACKAGE)

    /** Tailscale 앱을 연다. 없으면 Play 스토어 (스토어 앱이 없으면 웹) */
    private fun openTailscale() {
        val launch = tailscaleLaunchIntent()
        val intents = if (launch != null) {
            listOf(launch)
        } else {
            listOf(
                Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${Landing.TAILSCALE_PACKAGE}")),
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${Landing.TAILSCALE_PACKAGE}")),
            )
        }
        for (intent in intents) {
            try {
                activity.startActivity(intent)
                return
            } catch (error: ActivityNotFoundException) {
                // 다음 것
            }
        }
    }

    private companion object {
        /** 연결·읽기 제한(1.5초) 위에 DNS 찾기 여유 */
        const val PROBE_DEADLINE_MS = 2_000L
    }
}
