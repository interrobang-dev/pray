package dev.interrobang.pray

import org.json.JSONObject
import java.time.Instant
import kotlin.math.min

/** SSE 이벤트 하나. id = 그때까지 받은 마지막 `id:` (다시 붙을 때 Last-Event-ID 로 보낸다) */
data class SseEvent(val id: String?, val event: String, val data: String)

/**
 * SSE 줄 해석 (순수, WHATWG EventSource 규칙 중 쓰는 것만). 줄을 하나씩 넣고 빈 줄에서 이벤트가 나온다.
 * `:` 로 시작하는 줄(`: ping`)은 주석이라 버린다. `retry:` 는 쓰지 않는다 (다시 붙는 간격은 reconnectDelayMs)
 */
class SseParser {
    private val data = StringBuilder()
    private var hasData = false
    private var event = ""

    /** 마지막으로 받은 `id:` (이벤트를 보내도 남는다) */
    var lastEventId: String? = null
        private set

    fun line(line: String): SseEvent? {
        if (line.isEmpty()) return dispatch()
        if (line.startsWith(":")) return null
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.substring(0, colon)
        var value = if (colon < 0) "" else line.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
            "event" -> event = value
            "id" -> if (!value.contains('\u0000')) lastEventId = value
        }
        return null
    }

    private fun dispatch(): SseEvent? {
        val result = if (hasData) SseEvent(lastEventId, event.ifEmpty { "message" }, data.toString()) else null
        data.setLength(0)
        hasData = false
        event = ""
        return result
    }
}

/** 서버 `GET /api/notifications/stream` 의 `event: notice` 하나. kind = done·my-turn·needs-approval·hand-over·reminder */
data class Notice(
    val id: String,
    val kind: String,
    /** 그 세션. reminder 면 null 일 수 있다 */
    val sessionId: String?,
    val title: String,
    val body: String,
    val team: String?,
    val part: String?,
    /** 서버가 정한 시각 (ms). 못 읽으면 null */
    val atMillis: Long?,
)

object Notices {
    /** notice 의 data JSON 해석. JSON 이 아니거나 kind·title 이 없으면 null */
    fun parse(data: String): Notice? {
        val root = try {
            JSONObject(data)
        } catch (error: Exception) {
            return null
        }
        val kind = root.optString("kind", "")
        val title = root.optString("title", "")
        if (kind.isEmpty() || title.isEmpty()) return null
        val place = root.optJSONObject("place")
        return Notice(
            id = if (root.isNull("id")) "" else root.opt("id")?.toString() ?: "",
            kind = kind,
            sessionId = if (root.isNull("sessionId")) null else root.optString("sessionId", "").ifEmpty { null },
            title = title,
            body = if (root.isNull("body")) "" else root.optString("body", ""),
            team = place?.let { if (it.isNull("team")) null else it.optString("team", "").ifEmpty { null } },
            part = place?.let { if (it.isNull("part")) null else it.optString("part", "").ifEmpty { null } },
            atMillis = timeOf(root.opt("at")),
        )
    }

    /** at 이 ms 수든 ISO 글이든 ms 로 */
    private fun timeOf(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is String -> value.toLongOrNull() ?: try {
            Instant.parse(value).toEpochMilli()
        } catch (error: Exception) {
            null
        }
        else -> null
    }
}

const val RECONNECT_FIRST_MS = 2_000L
const val RECONNECT_MAX_MS = 60_000L

/** 끊긴 뒤 다시 붙기까지 기다릴 시간: 연속 실패 0번째 2초에서 두 배씩, 60초까지 */
fun reconnectDelayMs(failures: Int): Long {
    if (failures <= 0) return RECONNECT_FIRST_MS
    val shift = min(failures, 30)
    return min(RECONNECT_MAX_MS, RECONNECT_FIRST_MS shl shift)
}
