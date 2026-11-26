package dev.interrobang.pray

import org.json.JSONArray
import org.json.JSONObject

/** Pray 가 도는 PC 하나. name = Tailscale 기기 이름, url = 끝 슬래시 없는 `http://이름:4710`, hostName = 그 PC 의 OS 이름(랜딩 카드에 작게. 주소를 손으로 넣은 PC 는 목록을 받기 전까지 null) */
data class Machine(val name: String, val url: String, val hostName: String? = null)

/** `GET /api/machines` 의 기기 하나 중 앱이 쓰는 칸 */
data class ListedMachine(val name: String, val url: String?, val isSelf: Boolean, val hasPray: Boolean, val hostName: String? = null)

/** 링크를 어디서 열지 */
enum class LinkTarget { IN_APP, EXTERNAL }

const val PRAY_PORT = 4710

/** PC 목록·주소·링크 판정 (순수. Android API 를 쓰지 않아 JUnit 으로 본다) */
object Machines {
    private val ADDRESS = Regex("""^(https?)://([^/:?#\s]+)(?::(\d{1,5}))?(?:[/?#].*)?$""", RegexOption.IGNORE_CASE)

    /** 주소의 scheme·host(소문자)·port. http(s) 가 아니거나 꼴이 틀리면 null. java.net.URI 는 `2-office` 처럼 숫자로 시작하는 한 칸 이름의 host 를 null 로 줘서 쓰지 않는다 */
    private fun parts(url: String): Triple<String, String, Int>? {
        val match = ADDRESS.matchEntire(url.trim()) ?: return null
        val scheme = match.groupValues[1].lowercase()
        val host = match.groupValues[2].lowercase()
        val port = match.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull()
            ?: if (scheme == "https") 443 else 80
        return Triple(scheme, host, port)
    }

    /** 사람이 넣은 주소 → `http://host:port`. scheme 이 없으면 http, port 가 없으면 4710. 비었거나 꼴이 틀리면 null */
    fun normalizeAddress(input: String): String? {
        var text = input.trim()
        if (text.isEmpty()) return null
        if (!text.contains("://")) text = "http://$text"
        val match = ADDRESS.matchEntire(text) ?: return null
        val scheme = match.groupValues[1].lowercase()
        val host = match.groupValues[2].lowercase()
        val port = match.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: PRAY_PORT
        if (port !in 1..65535) return null
        return "$scheme://$host:$port"
    }

    /** 주소의 PC 이름: host 의 첫 칸 (IP 면 IP 그대로). 꼴이 틀리면 url 그대로 */
    fun nameOf(url: String): String {
        val host = parts(url)?.second ?: return url
        return if (isIpv4(host)) host else host.substringBefore('.')
    }

    private fun isIpv4(host: String): Boolean = host.split('.').let { it.size == 4 && it.all { part -> part.toIntOrNull() in 0..255 } }

    /** `/api/machines` 응답 해석. JSON 이 아니거나 machines 배열이 없으면 null */
    fun parsePayload(json: String): List<ListedMachine>? {
        val root = try {
            JSONObject(json)
        } catch (error: Exception) {
            return null
        }
        val array = root.optJSONArray("machines") ?: return null
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val name = item.optString("name", "")
            if (name.isEmpty()) return@mapNotNull null
            val url = if (item.isNull("url")) null else item.optString("url", "").trimEnd('/').ifEmpty { null }
            val hostName = if (item.isNull("hostName")) null else item.optString("hostName", "").ifEmpty { null }
            ListedMachine(name, url, item.optBoolean("isSelf", false), item.optBoolean("hasPray", false), hostName)
        }
    }

    /**
     * 받은 목록으로 저장할 PC 목록을 만든다. 주소가 있고 지금 Pray 가 있거나, 전에 알던(previous 에 같은 이름) PC 를 남긴다 —
     * Pray 확인은 1.5초 제한이라 한 번 못 찾았다고 빼면 알림·앱 안 열기가 들쭉날쭉해서다. 이름순.
     * 받은 목록이 비었으면(Tailscale 이 꺼짐 등) 알 수 없으니 previous 그대로
     */
    fun merge(previous: List<Machine>, listed: List<ListedMachine>): List<Machine> {
        if (listed.isEmpty()) return previous
        val known = previous.map { it.name }.toSet()
        return listed
            .filter { it.url != null && (it.hasPray || it.name in known) }
            .map { Machine(it.name, it.url!!, it.hostName) }
            .distinctBy { it.name }
            .sortedBy { it.name }
    }

    /** 이 url 이 저장한 PC 중 어느 것인지. port 가 같고 host 가 같거나, 한쪽이 다른 쪽의 첫 칸(MagicDNS 짧은 이름 `2-office` ↔ `2-office.xxx.ts.net`) */
    fun machineFor(url: String, machines: List<Machine>): Machine? {
        val (_, host, port) = parts(url) ?: return null
        return machines.firstOrNull { machine ->
            val (_, machineHost, machinePort) = parts(machine.url) ?: return@firstOrNull false
            port == machinePort && (host == machineHost || isShortNameOf(host, machineHost) || isShortNameOf(machineHost, host))
        }
    }

    private fun isShortNameOf(short: String, full: String): Boolean = !isIpv4(full) && !short.contains('.') && full.startsWith("$short.")

    /** WebView 가 이동하려는 링크: 저장한 PC 는 앱 안, 그 밖 http(s)·mailto 등은 폰 브라우저·다른 앱. blob·data·about·javascript 는 페이지 안 것이라 앱 안 */
    fun linkTarget(url: String, machines: List<Machine>): LinkTarget {
        val scheme = url.substringBefore(':', "").lowercase()
        return when (scheme) {
            "blob", "data", "about", "javascript" -> LinkTarget.IN_APP
            "http", "https" -> if (machineFor(url, machines) != null) LinkTarget.IN_APP else LinkTarget.EXTERNAL
            else -> LinkTarget.EXTERNAL
        }
    }

    fun toJson(machines: List<Machine>): String =
        JSONArray(machines.map { JSONObject().put("name", it.name).put("url", it.url).put("hostName", it.hostName) }).toString()

    fun fromJson(json: String?): List<Machine> {
        if (json.isNullOrEmpty()) return emptyList()
        val array = try {
            JSONArray(json)
        } catch (error: Exception) {
            return emptyList()
        }
        return (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val name = item.optString("name", "")
            val url = item.optString("url", "")
            val hostName = if (item.isNull("hostName")) null else item.optString("hostName", "").ifEmpty { null }
            if (name.isEmpty() || url.isEmpty()) null else Machine(name, url, hostName)
        }
    }
}
