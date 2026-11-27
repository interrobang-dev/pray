package dev.interrobang.pray

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.URLUtil
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.Executors

/**
 * 웹 Files 탭의 Download(`<a href download>` → WebView 다운로드)와 Share…(`window.PrayShare.share(url, fileName)`).
 * Download 는 DownloadManager 로 공개 Downloads 폴더에, Share 는 cache `share/` 에 받아 FileProvider 로 공유 창을 연다.
 * 주소 검사·이름 해석은 FileTransfer.kt (→ .claude/rules/android.md "받기·공유")
 */
class FileTransfers(private val activity: Activity, private val web: WebView) {
    /** 공유 받기는 한 번에 하나 (cache `share/` 를 비우고 쓰므로 겹치면 서로 지운다) */
    private val shareExecutor = Executors.newSingleThreadExecutor { Thread(it, "pray-share").apply { isDaemon = true } }

    @SuppressLint("JavascriptInterface")
    fun install() {
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            download(url, userAgent, contentDisposition, mimeType)
        }
        web.addJavascriptInterface(ShareBridge(), FileTransfer.SHARE_BRIDGE_NAME)
    }

    // ── Download ──

    private fun download(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        val name = FileTransfer.safeFileName(
            FileTransfer.fileNameFromDisposition(contentDisposition)
                ?: FileTransfer.fileNameFromUrl(url)
                ?: URLUtil.guessFileName(url, contentDisposition, mimeType),
        )
        try {
            // http(s) 가 아니면(blob: 등) 여기서 던진다
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                cookieFor(url)?.let { addRequestHeader("Cookie", it) }
                if (!userAgent.isNullOrEmpty()) addRequestHeader("User-Agent", userAgent)
                setMimeType(mimeFor(name, mimeType))
                setTitle(name)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                // minSdk 29: 공개 Downloads 는 저장 권한 없이 쓴다
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            }
            activity.getSystemService(DownloadManager::class.java).enqueue(request)
            toast("Downloading $name")
        } catch (error: Exception) {
            toast("Can't download $name")
        }
    }

    // ── Share ──

    /** 모든 페이지·frame 에 노출된다. 지금 연 PC 의 받기 API 주소만 받는다 (FileTransfer.isShareUrl) */
    private inner class ShareBridge {
        @JavascriptInterface
        fun share(url: String?, fileName: String?) {
            if (url == null) return
            // 브리지 스레드에서는 web.url 을 못 읽는다
            activity.runOnUiThread { startShare(url, fileName) }
        }
    }

    private fun startShare(url: String, fileName: String?) {
        if (activity.isDestroyed || !FileTransfer.isShareUrl(url, web.url)) return
        val name = FileTransfer.safeFileName(fileName?.takeIf { it.isNotBlank() } ?: FileTransfer.fileNameFromUrl(url))
        val userAgent = web.settings.userAgentString
        toast("Preparing $name…")
        shareExecutor.execute {
            val result = fetchForShare(url, name, userAgent)
            activity.runOnUiThread { onShareFetched(result) }
        }
    }

    private sealed class ShareResult {
        abstract val name: String

        data class Ready(override val name: String, val file: File) : ShareResult()
        data class TooLarge(override val name: String) : ShareResult()
        data class Failed(override val name: String, val reason: String) : ShareResult()
    }

    /** cache `share/` 를 비우고 그 안에 받는다. 100MB 를 넘으면 끊는다. 백그라운드 스레드에서 */
    private fun fetchForShare(url: String, name: String, userAgent: String?): ShareResult {
        val folder = File(activity.cacheDir, "share").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = File(folder, name)
        var connection: HttpURLConnection? = null
        return try {
            connection = PrayHttp.open(url, SHARE_READ_TIMEOUT_MS)
            // 다른 곳으로 넘기면 쿠키가 따라가지 않게 따라가지 않는다
            connection.instanceFollowRedirects = false
            if (!userAgent.isNullOrEmpty()) connection.setRequestProperty("User-Agent", userAgent)
            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK) return ShareResult.Failed(name, "HTTP $code")
            if (connection.contentLengthLong > FileTransfer.MAX_SHARE_BYTES) return ShareResult.TooLarge(name)
            var total = 0L
            var isTooLarge = false
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        if (total > FileTransfer.MAX_SHARE_BYTES) {
                            isTooLarge = true
                            break
                        }
                        output.write(buffer, 0, read)
                    }
                }
            }
            if (isTooLarge) {
                file.delete()
                ShareResult.TooLarge(name)
            } else {
                ShareResult.Ready(name, file)
            }
        } catch (error: IOException) {
            file.delete()
            ShareResult.Failed(name, error.message ?: "network error")
        } finally {
            connection?.disconnect()
        }
    }

    private fun onShareFetched(result: ShareResult) {
        if (activity.isDestroyed) return
        when (result) {
            is ShareResult.TooLarge -> toast("${result.name} is over 100 MB")
            is ShareResult.Failed -> toast("Can't share ${result.name} · ${result.reason}")
            is ShareResult.Ready -> openShareSheet(result.name, result.file)
        }
    }

    private fun openShareSheet(name: String, file: File) {
        val uri = try {
            FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        } catch (error: IllegalArgumentException) {
            toast("Can't share $name")
            return
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mimeFor(name, null)
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TITLE, name)
            clipData = ClipData.newRawUri(name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            activity.startActivity(Intent.createChooser(send, null))
        } catch (error: ActivityNotFoundException) {
            toast("No app to share with")
        }
    }

    // ── 공통 ──

    /** 서버가 준 MIME 이 쓸 만하면 그대로, octet-stream·없음이면 확장자로. 모르면 application/octet-stream */
    private fun mimeFor(name: String, given: String?): String {
        if (!given.isNullOrBlank() && given != OCTET_STREAM) return given
        val extension = FileTransfer.extensionOf(name) ?: return OCTET_STREAM
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: OCTET_STREAM
    }

    private fun cookieFor(url: String): String? = try {
        CookieManager.getInstance().getCookie(url)
    } catch (error: Throwable) {
        null
    }

    private fun toast(text: String) {
        Toast.makeText(activity.applicationContext, text, Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val OCTET_STREAM = "application/octet-stream"
        const val SHARE_READ_TIMEOUT_MS = 60_000
    }
}
