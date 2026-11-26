package dev.interrobang.pray

import java.io.IOException
import java.net.HttpURLConnection

/**
 * PC 하나의 `GET /api/notifications/stream` SSE 를 붙들고 있는 스레드.
 * 끊기면 reconnectDelayMs 간격(2초→60초)으로 다시 붙고, 다시 붙을 때 Last-Event-ID 를 보낸다.
 * 404(옛 Pray)·401(로그인 필요)은 10분 뒤 다시 본다 (앱을 열면 reconnect 로 바로)
 */
class StreamWorker(val machine: Machine, private val listener: Listener) : Thread("pray-stream-${machine.name}") {
    interface Listener {
        fun onState(machine: Machine, state: StreamState)
        fun onNotice(machine: Machine, notice: Notice)
    }

    @Volatile
    private var isStopped = false

    @Volatile
    private var connection: HttpURLConnection? = null

    private val lock = Object()
    private var isWoken = false
    @Volatile
    private var failures = 0
    private var lastEventId: String? = null

    /** 기다리던 중이면 바로 다시 붙는다. 붙어 있으면 그대로 */
    fun wake() {
        synchronized(lock) {
            isWoken = true
            lock.notifyAll()
        }
    }

    /** 네트워크가 바뀌었을 때: 붙어 있던 연결도 끊고(옛 네트워크의 소켓일 수 있다) 바로 다시 붙는다 */
    fun reconnect() {
        failures = 0
        connection?.disconnect()
        wake()
    }

    fun shutdown() {
        isStopped = true
        connection?.disconnect()
        wake()
    }

    override fun run() {
        while (!isStopped) {
            val state = connectOnce()
            if (isStopped) break
            listener.onState(machine, state)
            val delay = when (state) {
                StreamState.OUTDATED, StreamState.UNAUTHORIZED -> RETRY_REJECTED_MS
                else -> reconnectDelayMs(failures++)
            }
            pause(delay)
        }
    }

    /** 한 번 붙어 끊길 때까지 읽는다. 끝난 까닭을 상태로 준다 */
    private fun connectOnce(): StreamState {
        var opened: HttpURLConnection? = null
        try {
            opened = PrayHttp.open("${machine.url}/api/notifications/stream", READ_TIMEOUT_MS)
            connection = opened
            opened.setRequestProperty("Accept", "text/event-stream")
            lastEventId?.let { opened.setRequestProperty("Last-Event-ID", it) }
            when (opened.responseCode) {
                200 -> Unit
                404 -> return StreamState.OUTDATED
                401 -> return StreamState.UNAUTHORIZED
                else -> return StreamState.DISCONNECTED
            }
            // 스트림이 없는 옛 서버는 모르는 GET 경로에 404 가 아니라 웹 index.html(200 text/html)을 준다 (실측)
            if (opened.contentType?.lowercase()?.startsWith("text/event-stream") != true) return StreamState.OUTDATED
            listener.onState(machine, StreamState.CONNECTED)
            val parser = SseParser()
            opened.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                while (!isStopped) {
                    val line = reader.readLine() ?: break
                    // 한 줄이라도 받았으면 제대로 붙은 것이라 실패 수를 지운다 (붙자마자 끊기는 서버에 2초마다 붙지 않게)
                    failures = 0
                    val event = parser.line(line) ?: continue
                    lastEventId = event.id ?: lastEventId
                    if (event.event != "notice") continue
                    Notices.parse(event.data)?.let { listener.onNotice(machine, it) }
                }
            }
        } catch (error: IOException) {
            // 끊김·시간 초과(15초마다 ping 이 와서 45초 동안 아무것도 없으면 죽은 연결)
        } catch (error: RuntimeException) {
            // 잘못된 주소 등
        } finally {
            connection = null
            opened?.disconnect()
        }
        return StreamState.DISCONNECTED
    }

    private fun pause(delayMs: Long) {
        synchronized(lock) {
            if (!isWoken && !isStopped) {
                try {
                    lock.wait(delayMs)
                } catch (error: InterruptedException) {
                    // shutdown
                }
            }
            isWoken = false
        }
    }

    private companion object {
        const val READ_TIMEOUT_MS = 45_000
        const val RETRY_REJECTED_MS = 10 * 60_000L
    }
}
