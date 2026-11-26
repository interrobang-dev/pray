package dev.interrobang.pray

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SseTest {
    private fun feed(parser: SseParser, vararg lines: String): List<SseEvent> = lines.mapNotNull { parser.line(it) }

    @Test
    fun parsesNoticeEventWithId() {
        val parser = SseParser()
        val events = feed(parser, "id: 7", "event: notice", """data: {"id":7}""", "")
        assertEquals(listOf(SseEvent("7", "notice", """{"id":7}""")), events)
        assertEquals("7", parser.lastEventId)
    }

    @Test
    fun ignoresPingCommentsAndEmptyDispatch() {
        val parser = SseParser()
        assertEquals(emptyList<SseEvent>(), feed(parser, ": ping", "", "", ":"))
    }

    @Test
    fun joinsMultipleDataLinesAndDefaultsEventName() {
        val parser = SseParser()
        assertEquals(listOf(SseEvent(null, "message", "a\nb")), feed(parser, "data: a", "data:b", ""))
    }

    @Test
    fun keepsLastEventIdAcrossEventsAndResetsEventName() {
        val parser = SseParser()
        val events = feed(parser, "id: 3", "event: notice", "data: x", "", "data: y", "")
        assertEquals(SseEvent("3", "notice", "x"), events[0])
        assertEquals(SseEvent("3", "message", "y"), events[1])
    }

    @Test
    fun stripsOnlyOneLeadingSpaceAndHandlesFieldWithoutColon() {
        val parser = SseParser()
        assertEquals(listOf(SseEvent(null, "message", " two")), feed(parser, "data:  two", ""))
        assertEquals(listOf(SseEvent(null, "message", "")), feed(parser, "data", ""))
    }

    @Test
    fun parseNoticeReadsServerShape() {
        val notice = Notices.parse(
            """{"id":12,"kind":"done","sessionId":"0f9c-uuid","title":"[FE] Sujin · Done","body":"Fixed the bar","place":{"team":"pray","part":"FE"},"at":1795000000000}""",
        )!!
        assertEquals(Notice("12", "done", "0f9c-uuid", "[FE] Sujin · Done", "Fixed the bar", "pray", "FE", 1795000000000), notice)
    }

    @Test
    fun parseNoticeAllowsNullSessionAndPlaceAndIsoTime() {
        val notice = Notices.parse("""{"id":"13","kind":"reminder","sessionId":null,"title":"Standup","body":"","place":null,"at":"2026-11-26T01:00:00Z"}""")!!
        assertNull(notice.sessionId)
        assertNull(notice.team)
        assertEquals("13", notice.id)
        assertEquals(1795654800000L, notice.atMillis)
    }

    @Test
    fun parseNoticeRejectsBadData() {
        assertNull(Notices.parse("not json"))
        assertNull(Notices.parse("""{"id":1,"title":"x"}"""))
        assertNull(Notices.parse("""{"id":1,"kind":"done"}"""))
    }

    @Test
    fun reconnectDelayDoublesFromTwoSecondsUpToAMinute() {
        assertEquals(listOf(2_000L, 4_000L, 8_000L, 16_000L, 32_000L, 60_000L, 60_000L), (0..6).map { reconnectDelayMs(it) })
        assertEquals(60_000L, reconnectDelayMs(1_000))
        assertEquals(2_000L, reconnectDelayMs(-1))
    }
}
