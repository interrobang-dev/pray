package dev.interrobang.pray

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NoticeTextTest {
    private val office = Machine("2-office", "http://2-office.tailda52be.ts.net:4710")

    private fun notice(kind: String = "done", sessionId: String? = "s1", id: String = "1") =
        Notice(id, kind, sessionId, "[FE] Sujin · Done", "body", null, null, null)

    @Test
    fun channelForKind() {
        assertEquals(NoticeChannel.APPROVAL, NoticeText.channelFor("needs-approval"))
        assertEquals(NoticeChannel.TURN, NoticeText.channelFor("done"))
        assertEquals(NoticeChannel.TURN, NoticeText.channelFor("my-turn"))
        assertEquals(NoticeChannel.HAND_OVER, NoticeText.channelFor("hand-over"))
        assertEquals(NoticeChannel.REMINDERS, NoticeText.channelFor("reminder"))
        assertEquals(NoticeChannel.TURN, NoticeText.channelFor("something-new"))
    }

    @Test
    fun titleHasPcName() {
        assertEquals("2-office · [FE] Sujin · Done", NoticeText.title("2-office", notice()))
    }

    @Test
    fun openUrlUsesSessionHash() {
        assertEquals("http://2-office.tailda52be.ts.net:4710/#session=abc-123", NoticeText.openUrl(office, "abc-123"))
        assertEquals("http://2-office.tailda52be.ts.net:4710/#session=a%20b%26c", NoticeText.openUrl(office, "a b&c"))
        assertEquals("http://2-office.tailda52be.ts.net:4710/", NoticeText.openUrl(office, null))
    }

    @Test
    fun notificationIdIsPerSessionAndPc() {
        assertEquals(NoticeText.notificationId("2-office", notice("needs-approval")), NoticeText.notificationId("2-office", notice("done", id = "2")))
        assertNotEquals(NoticeText.notificationId("2-office", notice()), NoticeText.notificationId("1-home", notice()))
        assertNotEquals(
            NoticeText.notificationId("2-office", notice("reminder", null, "5")),
            NoticeText.notificationId("2-office", notice("reminder", null, "6")),
        )
    }

    @Test
    fun ongoingListsConnectedPcsAndIssues() {
        val (title, text) = NoticeText.ongoing(
            mapOf("2-office" to StreamState.CONNECTED, "1-home" to StreamState.CONNECTED, "4-old" to StreamState.OUTDATED),
        )
        assertEquals("Connected · 1-home, 2-office", title)
        assertEquals("4-old: update Pray", text)
    }

    @Test
    fun ongoingWithNothingConnected() {
        val (title, text) = NoticeText.ongoing(mapOf("2-office" to StreamState.DISCONNECTED, "1-home" to StreamState.UNAUTHORIZED))
        assertEquals("Not connected", title)
        assertEquals("1-home: sign in", text)
        assertNull(NoticeText.ongoing(mapOf("2-office" to StreamState.CONNECTED)).second)
    }
}
