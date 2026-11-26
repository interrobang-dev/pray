package dev.interrobang.pray

import org.json.JSONObject

/** 랜딩 카드의 Pray 응답 확인 (`GET <pc>/api/auth/me`) */
enum class ProbeState { CHECKING, ANSWERS, NO_ANSWER }

/** 랜딩 맨 위 Tailscale 줄 */
enum class TailscaleBanner(val title: String, val detail: String?, val hasButton: Boolean) {
    OFF("Tailscale is off", "Turn it on to reach your PCs", true),
    CONNECTED("Tailscale connected", null, false),
    /** VPN 은 켜졌는데 확인한 PC 가 하나도 답하지 않음. 다른 VPN 은 TRANSPORT_VPN 으로 구분할 수 없어서 PC 응답과 같이 본다 */
    NO_PC_ANSWERS("Connected, but no PC answers", "Check that Tailscale is on (not another VPN) and Pray is running", true),
}

/** 앱 화면 */
enum class Screen { LANDING, SETUP, WEB }

/** 뒤로 가기 */
enum class BackAction { WEB_BACK, TO_LANDING, CLOSE }

/** 랜딩 화면의 판정·글자 (순수) */
object Landing {
    const val TAILSCALE_PACKAGE = "com.tailscale.ipn"

    /** `/api/auth/me` 응답이 Pray 인지: JSON 의 app 이 'pray' (서버 tailscale.ts 의 probePray 와 같은 기준) */
    fun isPrayAnswer(body: String): Boolean = try {
        JSONObject(body).optString("app") == "pray"
    } catch (error: Exception) {
        false
    }

    /** VPN 이 꺼졌으면 OFF. 켜졌고 확인할 PC 가 있는데 모두 확인이 끝나 하나도 답하지 않으면 NO_PC_ANSWERS. 그 밖(확인 중 포함)은 CONNECTED */
    fun banner(isVpnOn: Boolean, probes: Collection<ProbeState>): TailscaleBanner = when {
        !isVpnOn -> TailscaleBanner.OFF
        probes.isNotEmpty() && probes.all { it == ProbeState.NO_ANSWER } -> TailscaleBanner.NO_PC_ANSWERS
        else -> TailscaleBanner.CONNECTED
    }

    /** Tailscale 앱이 있으면 열고, 없으면 Play 스토어 */
    fun tailscaleButtonLabel(isInstalled: Boolean): String = if (isInstalled) "Open Tailscale" else "Get Tailscale"

    /** 카드 순서: Tailscale 이름순, 대소문자 무시 (웹 PC 메뉴 `compareNames` 와 같다) */
    fun sorted(machines: List<Machine>): List<Machine> = machines.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

    /** 이름 밑 작은 줄: OS 이름(이름과 다를 때), 없으면 주소의 host:port */
    fun subtitle(machine: Machine): String {
        val hostName = machine.hostName?.trim()
        if (!hostName.isNullOrEmpty() && !hostName.equals(machine.name, ignoreCase = true)) return hostName
        return machine.url.substringAfter("://")
    }

    fun dot(probe: ProbeState): String = if (probe == ProbeState.ANSWERS) "●" else "○"

    fun probeLabel(probe: ProbeState): String = when (probe) {
        ProbeState.CHECKING -> "Checking…"
        ProbeState.ANSWERS -> "Pray answers"
        ProbeState.NO_ANSWER -> "No answer"
    }

    /** 알림 스트림 상태 (NotifyService 가 AppState.streamStates 에 둔 것). 서비스가 안 떠 있으면 null */
    fun streamLabel(state: StreamState?): String = when (state) {
        StreamState.CONNECTED -> "Notifications connected"
        StreamState.OUTDATED -> "Notifications: update Pray"
        StreamState.UNAUTHORIZED -> "Notifications: sign in"
        StreamState.DISCONNECTED, null -> "Notifications not connected"
    }

    /** 카드 둘째 줄: "Pray answers · Notifications connected" */
    fun statusLine(probe: ProbeState, stream: StreamState?): String = "${probeLabel(probe)} · ${streamLabel(stream)}"

    /** 뒤로: 랜딩이면 앱 닫기, 주소 입력·못 붙음 화면이면 랜딩, 웹은 기록이 있으면 뒤로 없으면 랜딩 */
    fun back(screen: Screen, isErrorShown: Boolean, canGoBack: Boolean): BackAction = when (screen) {
        Screen.LANDING -> BackAction.CLOSE
        Screen.SETUP -> BackAction.TO_LANDING
        Screen.WEB -> if (!isErrorShown && canGoBack) BackAction.WEB_BACK else BackAction.TO_LANDING
    }
}
