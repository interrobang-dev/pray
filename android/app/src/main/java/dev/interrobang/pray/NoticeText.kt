package dev.interrobang.pray

import java.net.URLEncoder

/** PC 하나의 알림 스트림 상태 */
enum class StreamState {
    /** 아직 못 붙었거나 끊겨 다시 붙는 중 */
    DISCONNECTED,
    CONNECTED,
    /** 스트림이 404: 옛 Pray. 화면만 쓴다 */
    OUTDATED,
    /** 401: 로그인이 필요하다. 그 PC 알림은 끈다 (웹 로그인 화면을 따른다) */
    UNAUTHORIZED,
}

/** 알림 채널 */
enum class NoticeChannel(val id: String, val label: String) {
    SERVICE("service", "Connection"),
    APPROVAL("approval", "Needs approval"),
    TURN("turn", "Done / My turn"),
    HAND_OVER("hand-over", "Hand over"),
    REMINDERS("reminders", "Reminders"),
}

/** 알림 글자·채널·여는 주소 (순수) */
object NoticeText {
    const val ONGOING_NOTIFICATION_ID = 1

    /** kind → 채널. 모르는 kind 는 보통 채널 (서버가 새 종류를 더해도 보이게) */
    fun channelFor(kind: String): NoticeChannel = when (kind) {
        "needs-approval" -> NoticeChannel.APPROVAL
        "hand-over" -> NoticeChannel.HAND_OVER
        "reminder" -> NoticeChannel.REMINDERS
        else -> NoticeChannel.TURN
    }

    /** 머리에 PC 이름: `2-office · [FE] Sujin · Done` */
    fun title(machineName: String, notice: Notice): String = "$machineName · ${notice.title}"

    /** 누르면 열 주소: 그 PC 의 `#session=<id>` (웹이 처리한다). 세션이 없으면 그 PC 첫 화면 */
    fun openUrl(machine: Machine, sessionId: String?): String {
        if (sessionId.isNullOrEmpty()) return "${machine.url}/"
        // 웹은 decodeURIComponent 로 읽는다 — URLEncoder 의 + 는 공백으로 안 돌아와서 %20 으로
        val encoded = URLEncoder.encode(sessionId, "UTF-8").replace("+", "%20")
        return "${machine.url}/#session=$encoded"
    }

    /** 알림 ID: 같은 PC·같은 세션은 한 칸을 바꿔 쓴다 (승인 대기 뒤 Done 이 오면 Done 만 남게). 세션 없는 알림은 그 알림마다. 상시 알림 ID 는 피한다 */
    fun notificationId(machineName: String, notice: Notice): Int {
        val key = machineName + "|" + (notice.sessionId ?: "notice:${notice.id}")
        val id = key.hashCode()
        return if (id == ONGOING_NOTIFICATION_ID) id + 1 else id
    }

    /** 상시 알림 제목·본문. 제목 "Connected · 1-home, 2-office"(없으면 "Not connected"), 본문은 PC 별 문제 "2-office: update Pray" (없으면 null) */
    fun ongoing(states: Map<String, StreamState>): Pair<String, String?> {
        val names = states.keys.sorted()
        val connected = names.filter { states[it] == StreamState.CONNECTED }
        val title = if (connected.isEmpty()) "Not connected" else "Connected · ${connected.joinToString(", ")}"
        val issues = names.mapNotNull { name ->
            when (states[name]) {
                StreamState.OUTDATED -> "$name: update Pray"
                StreamState.UNAUTHORIZED -> "$name: sign in"
                else -> null
            }
        }
        return title to issues.joinToString(" · ").ifEmpty { null }
    }
}
