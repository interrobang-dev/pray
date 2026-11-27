package dev.interrobang.pray

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileTransferTest {
    private val page = "http://2-office.tail1234.ts.net:4710/#session=abc"
    private val download = "http://2-office.tail1234.ts.net:4710/api/sessions/0a1b2c3d-4e5f-6789-abcd-ef0123456789/file/download?path=src%2Fa.txt"

    // ── isShareUrl ──

    @Test
    fun acceptsDownloadUrlOfSamePc() {
        assertTrue(FileTransfer.isShareUrl(download, page))
        // scheme·host 대소문자는 가리지 않는다
        assertTrue(FileTransfer.isShareUrl(download, "HTTP://2-Office.tail1234.ts.net:4710/"))
    }

    @Test
    fun defaultPortMatchesExplicitPort() {
        assertTrue(FileTransfer.isShareUrl("https://pc.example/api/sessions/x/file/download?path=a", "https://pc.example:443/"))
    }

    @Test
    fun rejectsOtherOrigin() {
        assertFalse(FileTransfer.isShareUrl(download, "http://1-home.tail1234.ts.net:4710/"))
        assertFalse(FileTransfer.isShareUrl(download, "http://2-office.tail1234.ts.net:4711/"))
        assertFalse(FileTransfer.isShareUrl(download, "https://2-office.tail1234.ts.net:4710/"))
        // 짧은 이름 ↔ 전체 이름도 같은 PC 로 보지 않는다 (웹은 location 으로 절대 주소를 만든다)
        assertFalse(FileTransfer.isShareUrl(download, "http://2-office:4710/"))
    }

    @Test
    fun rejectsWithoutPage() {
        assertFalse(FileTransfer.isShareUrl(download, null))
        assertFalse(FileTransfer.isShareUrl(download, "about:blank"))
    }

    @Test
    fun rejectsOtherPaths() {
        val base = "http://2-office.tail1234.ts.net:4710"
        assertFalse(FileTransfer.isShareUrl("$base/api/sessions/abc/file/raw?path=a", page))
        assertFalse(FileTransfer.isShareUrl("$base/api/sessions/abc/file/download/x?path=a", page))
        assertFalse(FileTransfer.isShareUrl("$base/api/sessions/../file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl("$base/api/sessions/a%2Fb/file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl("$base/x/api/sessions/abc/file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl("$base/", page))
    }

    @Test
    fun rejectsTrickyAddresses() {
        assertFalse(FileTransfer.isShareUrl("http://evil.com@2-office.tail1234.ts.net:4710/api/sessions/a/file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl("http://2-office.tail1234.ts.net:4710@evil.com/api/sessions/a/file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl("http://2-office.tail1234.ts.net:4710\\@evil.com/api/sessions/a/file/download", page))
        assertFalse(FileTransfer.isShareUrl("javascript:alert(1)", page))
        assertFalse(FileTransfer.isShareUrl("/api/sessions/a/file/download?path=a", page))
        assertFalse(FileTransfer.isShareUrl(" $download", page))
    }

    // ── fileNameFromDisposition ──

    @Test
    fun readsExtendedUtf8Name() {
        assertEquals("보고서 1.txt", FileTransfer.fileNameFromDisposition("attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C%201.txt"))
        assertEquals("a.txt", FileTransfer.fileNameFromDisposition("attachment; filename*=utf-8'ko'a.txt"))
    }

    @Test
    fun prefersExtendedOverPlain() {
        assertEquals(
            "한글.pdf",
            FileTransfer.fileNameFromDisposition("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%ED%95%9C%EA%B8%80.pdf"),
        )
    }

    @Test
    fun readsPlainName() {
        assertEquals("a b.txt", FileTransfer.fileNameFromDisposition("attachment; filename=\"a b.txt\""))
        assertEquals("say \"hi\".txt", FileTransfer.fileNameFromDisposition("attachment; filename=\"say \\\"hi\\\".txt\""))
        assertEquals("plain.txt", FileTransfer.fileNameFromDisposition("attachment; filename=plain.txt"))
    }

    @Test
    fun brokenExtendedFallsBackToPlain() {
        assertEquals("ok.txt", FileTransfer.fileNameFromDisposition("attachment; filename*=UTF-8''%E; filename=\"ok.txt\""))
        assertEquals("ok.txt", FileTransfer.fileNameFromDisposition("attachment; filename*=nope''a; filename=ok.txt"))
    }

    @Test
    fun noNameIsNull() {
        assertNull(FileTransfer.fileNameFromDisposition(null))
        assertNull(FileTransfer.fileNameFromDisposition(""))
        assertNull(FileTransfer.fileNameFromDisposition("attachment"))
        assertNull(FileTransfer.fileNameFromDisposition("attachment; filename=\"\""))
    }

    // ── fileNameFromUrl ──

    @Test
    fun nameFromPathQuery() {
        assertEquals("a.txt", FileTransfer.fileNameFromUrl(download))
        assertEquals("메모.md", FileTransfer.fileNameFromUrl("http://pc:4710/api/sessions/a/file/download?x=1&path=D%3A%5Cwork%5C%EB%A9%94%EB%AA%A8.md"))
        assertNull(FileTransfer.fileNameFromUrl("http://pc:4710/api/sessions/a/file/download"))
        assertNull(FileTransfer.fileNameFromUrl("http://pc:4710/api/sessions/a/file/download?path="))
    }

    // ── safeFileName ──

    @Test
    fun stripsPathSeparatorsAndUnsafeChars() {
        assertEquals("_.._etc_passwd", FileTransfer.safeFileName("/../etc/passwd"))
        assertEquals("a_b_c.txt", FileTransfer.safeFileName("a\\b/c.txt"))
        assertEquals("a_b_.txt", FileTransfer.safeFileName("a:b\u0000.txt"))
        assertEquals("x", FileTransfer.safeFileName("  ..x.. "))
    }

    @Test
    fun emptyBecomesFallback() {
        assertEquals(FileTransfer.FALLBACK_NAME, FileTransfer.safeFileName(null))
        assertEquals(FileTransfer.FALLBACK_NAME, FileTransfer.safeFileName(""))
        assertEquals(FileTransfer.FALLBACK_NAME, FileTransfer.safeFileName(".."))
        assertEquals(FileTransfer.FALLBACK_NAME, FileTransfer.safeFileName("///"))
    }

    @Test
    fun keepsKoreanName() {
        assertEquals("보고서 최종.hwpx", FileTransfer.safeFileName("보고서 최종.hwpx"))
    }

    @Test
    fun longNameIsCutKeepingExtension() {
        val name = FileTransfer.safeFileName("가".repeat(150) + ".pdf")
        assertTrue(name.endsWith(".pdf"))
        assertTrue(name.toByteArray(Charsets.UTF_8).size <= 200)
        assertTrue(name.startsWith("가가가"))
    }

    @Test
    fun extension() {
        assertEquals("pdf", FileTransfer.extensionOf("A.PDF"))
        assertEquals("gz", FileTransfer.extensionOf("a.tar.gz"))
        assertNull(FileTransfer.extensionOf(".bashrc"))
        assertNull(FileTransfer.extensionOf("Makefile"))
        assertNull(FileTransfer.extensionOf("a."))
    }
}
