package dev.interrobang.pray

import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.nio.charset.Charset

/**
 * 웹 Files 탭의 Download·Share… 가 쓰는 판정 (순수. JUnit 으로 본다).
 * 받기 주소 꼴: `<PC>/api/sessions/<세션id>/file/download?path=<encoded>` (→ .claude/rules/android.md "받기·공유")
 */
object FileTransfer {
    const val SHARE_BRIDGE_NAME = "PrayShare"
    const val MAX_SHARE_BYTES = 100L * 1024 * 1024
    const val FALLBACK_NAME = "download"

    private const val MAX_NAME_BYTES = 200

    private val URL_PARTS = Regex("""^(https?)://([^/:?#@]+)(?::(\d{1,5}))?(/[^?#]*)?(\?[^#]*)?(#.*)?$""", RegexOption.IGNORE_CASE)
    private val DOWNLOAD_PATH = Regex("""^/api/sessions/[A-Za-z0-9_-]+/file/download$""")
    private val EXTENDED_NAME = Regex("""(?:^|;)\s*filename\*\s*=\s*([^;\s]+)""", RegexOption.IGNORE_CASE)
    private val PLAIN_NAME = Regex("""(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))""", RegexOption.IGNORE_CASE)
    private val UNSAFE_CHARS = Regex("""[\u0000-\u001f\u007f/\\:*?"<>|]""")

    /**
     * Share… 가 넘긴 주소를 받을지: 지금 WebView 가 연 페이지(pageUrl)와 scheme·host·port 가 같고 경로가 받기 API 꼴이어야 한다.
     * 브리지는 모든 페이지·frame 에 노출되니 다른 곳의 주소로 쿠키를 붙여 받지 않게 막는다
     */
    fun isShareUrl(url: String, pageUrl: String?): Boolean {
        if (pageUrl == null || url.any { it == '\\' || it.isWhitespace() }) return false
        val target = URL_PARTS.matchEntire(url) ?: return false
        val page = URL_PARTS.matchEntire(pageUrl) ?: return false
        if (origin(target) != origin(page)) return false
        return DOWNLOAD_PATH.matches(target.groupValues[4])
    }

    private fun origin(match: MatchResult): Triple<String, String, Int?> {
        val scheme = match.groupValues[1].lowercase()
        val port = match.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull() ?: if (scheme == "https") 443 else 80
        return Triple(scheme, match.groupValues[2].lowercase(), port)
    }

    /**
     * Content-Disposition 의 파일 이름. `filename*=UTF-8''%EC%95%88.txt`(RFC 5987)를 먼저, 없거나 못 읽으면 `filename="…"`.
     * URLUtil.guessFileName 은 filename* 를 못 읽는 버전이 있어 직접 해석한다. 없으면 null (안전한 이름으로 바꾸기 전)
     */
    fun fileNameFromDisposition(contentDisposition: String?): String? {
        if (contentDisposition.isNullOrBlank()) return null
        EXTENDED_NAME.find(contentDisposition)?.let { match ->
            decodeExtended(match.groupValues[1])?.takeIf { it.isNotBlank() }?.let { return it }
        }
        val plain = PLAIN_NAME.find(contentDisposition) ?: return null
        val quoted = plain.groups[1]?.value
        val name = quoted?.replace(Regex("""\\(.)"""), "$1") ?: plain.groupValues[2].trim()
        return name.ifBlank { null }
    }

    /** `charset'lang'%XX…` → 글. charset 을 모르거나 % 꼴이 틀리면 null */
    private fun decodeExtended(value: String): String? {
        val parts = value.split('\'', limit = 3)
        if (parts.size != 3) return null
        val charset = try {
            Charset.forName(parts[0].ifEmpty { "UTF-8" })
        } catch (error: Exception) {
            return null
        }
        val text = parts[2]
        val bytes = ByteArrayOutputStream()
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (char == '%') {
                if (index + 2 >= text.length) return null
                val byte = text.substring(index + 1, index + 3).toIntOrNull(16) ?: return null
                bytes.write(byte)
                index += 3
            } else {
                bytes.write(char.toString().toByteArray(charset))
                index += 1
            }
        }
        return String(bytes.toByteArray(), charset)
    }

    /** 받기 주소의 `path=` 끝 이름 (Content-Disposition 이 없을 때). 없으면 null */
    fun fileNameFromUrl(url: String): String? {
        val query = url.substringAfter('?', "").substringBefore('#')
        val encoded = query.split('&').firstOrNull { it.startsWith("path=") }?.removePrefix("path=") ?: return null
        val path = try {
            URLDecoder.decode(encoded, "UTF-8")
        } catch (error: Exception) {
            return null
        }
        return path.trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').ifBlank { null }
    }

    /**
     * 폰에 저장할 이름: 경로 구분자·제어 문자·저장소가 안 받는 글자(`:*?"<>|`)를 `_` 로, 앞뒤 공백·점을 떼고,
     * UTF-8 200바이트를 넘으면 확장자를 남기고 줄인다. 남는 게 없으면 [FALLBACK_NAME]
     */
    fun safeFileName(name: String?): String {
        val cleaned = UNSAFE_CHARS.replace(name ?: "", "_").trim().trim('.', ' ')
        if (cleaned.isEmpty() || cleaned.all { it == '_' }) return FALLBACK_NAME
        if (cleaned.toByteArray(Charsets.UTF_8).size <= MAX_NAME_BYTES) return cleaned
        val extension = extensionOf(cleaned)?.takeIf { it.length <= 20 }?.let { ".$it" } ?: ""
        var base = cleaned.dropLast(extension.length)
        while (base.isNotEmpty() && (base + extension).toByteArray(Charsets.UTF_8).size > MAX_NAME_BYTES) base = base.dropLast(1)
        // 서로게이트 쌍 반쪽이 남지 않게
        if (base.isNotEmpty() && Character.isHighSurrogate(base.last())) base = base.dropLast(1)
        return (base + extension).ifEmpty { FALLBACK_NAME }
    }

    /** 확장자 (점 뒤, 소문자). 없으면 null */
    fun extensionOf(name: String): String? {
        val dot = name.lastIndexOf('.')
        if (dot <= 0 || dot == name.length - 1) return null
        return name.substring(dot + 1).lowercase()
    }
}
