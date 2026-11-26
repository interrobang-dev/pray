package dev.interrobang.pray

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 가짜 SSE 서버(ServerSocket — 단위 테스트 컴파일 클래스패스가 android.jar 라 JDK HttpServer 가 없다)에 붙여 본다:
 * notice 받기 → 끊기면 2초 뒤 Last-Event-ID 로 다시 → 404 면 OUTDATED, 401 이면 UNAUTHORIZED
 */
class StreamWorkerTest {
    private val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
    private val url = "http://127.0.0.1:${server.localPort}"
    private var worker: StreamWorker? = null

    @After
    fun tearDown() {
        worker?.shutdown()
        server.close()
    }

    /** 요청마다 머리를 읽어 respond(몇 번째, 머리) 가 준 응답 전체를 쓰고 닫는다 */
    private fun serve(respond: (index: Int, headers: Map<String, String>) -> String) {
        Thread {
            var index = 0
            while (!server.isClosed) {
                val socket = try {
                    server.accept()
                } catch (error: SocketException) {
                    break
                }
                socket.use {
                    val reader = it.getInputStream().bufferedReader(Charsets.UTF_8)
                    val headers = HashMap<String, String>()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                        val colon = line.indexOf(':')
                        if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
                    }
                    it.getOutputStream().write(respond(index++, headers).toByteArray(Charsets.UTF_8))
                    it.getOutputStream().flush()
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun startWorker(states: MutableList<StreamState>, notices: MutableList<Notice>, until: StreamState): CountDownLatch {
        val latch = CountDownLatch(1)
        worker = StreamWorker(Machine("test", url), object : StreamWorker.Listener {
            override fun onState(machine: Machine, state: StreamState) {
                states.add(state)
                if (state == until) latch.countDown()
            }

            override fun onNotice(machine: Machine, notice: Notice) {
                notices.add(notice)
            }
        }).also { it.isDaemon = true; it.start() }
        return latch
    }

    @Test
    fun receivesNoticeThenReconnectsWithLastEventIdAndStopsOn404() {
        val lastEventIds = CopyOnWriteArrayList<String?>()
        serve { index, headers ->
            lastEventIds.add(headers["last-event-id"])
            if (index == 0) {
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n" +
                    ": ping\n\nid: 41\nevent: notice\n" +
                    "data: {\"id\":41,\"kind\":\"needs-approval\",\"sessionId\":\"s-1\",\"title\":\"Sujin · Needs approval\",\"body\":\"Bash\",\"place\":null,\"at\":1}\n\n"
            } else {
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            }
        }
        val states = CopyOnWriteArrayList<StreamState>()
        val notices = CopyOnWriteArrayList<Notice>()
        val outdated = startWorker(states, notices, StreamState.OUTDATED)

        assertTrue("no 404 state within 10s", outdated.await(10, TimeUnit.SECONDS))
        assertEquals(listOf(StreamState.CONNECTED, StreamState.DISCONNECTED, StreamState.OUTDATED), states.toList())
        assertEquals(1, notices.size)
        assertEquals("needs-approval", notices[0].kind)
        assertEquals("s-1", notices[0].sessionId)
        assertNull(lastEventIds[0])
        assertEquals("41", lastEventIds[1])
    }

    @Test
    fun treatsHtmlFallbackOfOldServerAsOutdated() {
        serve { _, _ -> "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!doctype html>\n<html></html>\n" }
        val states = CopyOnWriteArrayList<StreamState>()
        val outdated = startWorker(states, CopyOnWriteArrayList(), StreamState.OUTDATED)
        assertTrue(outdated.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(StreamState.OUTDATED), states.toList())
    }

    @Test
    fun reportsUnauthorizedOn401() {
        serve { _, _ -> "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" }
        val states = CopyOnWriteArrayList<StreamState>()
        val unauthorized = startWorker(states, CopyOnWriteArrayList(), StreamState.UNAUTHORIZED)
        assertTrue(unauthorized.await(5, TimeUnit.SECONDS))
        assertEquals(listOf(StreamState.UNAUTHORIZED), states.toList())
    }
}
