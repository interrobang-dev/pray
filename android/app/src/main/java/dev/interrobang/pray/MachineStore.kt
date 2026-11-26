package dev.interrobang.pray

import android.content.Context
import android.webkit.CookieManager
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** 앱이 기억하는 것 (SharedPreferences `pray`): Pray PC 목록·마지막에 본 PC·권한을 한 번 물었는지 */
class MachineStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("pray", Context.MODE_PRIVATE)

    var machines: List<Machine>
        get() = Machines.fromJson(preferences.getString(KEY_MACHINES, null))
        set(value) = preferences.edit().putString(KEY_MACHINES, Machines.toJson(value)).apply()

    var lastMachineName: String?
        get() = preferences.getString(KEY_LAST_MACHINE, null)
        set(value) = preferences.edit().putString(KEY_LAST_MACHINE, value).apply()

    var hasAskedPermissions: Boolean
        get() = preferences.getBoolean(KEY_ASKED_PERMISSIONS, false)
        set(value) = preferences.edit().putBoolean(KEY_ASKED_PERMISSIONS, value).apply()

    /** 마지막에 본 PC. 없으면 첫 PC */
    fun lastMachine(): Machine? {
        val list = machines
        return list.firstOrNull { it.name == lastMachineName } ?: list.firstOrNull()
    }

    private companion object {
        const val KEY_MACHINES = "machines"
        const val KEY_LAST_MACHINE = "lastMachine"
        const val KEY_ASKED_PERMISSIONS = "hasAskedPermissions"
    }
}

/** `/api/machines` 받기 결과 */
sealed class MachinesResult {
    data class Ok(val listed: List<ListedMachine>) : MachinesResult()
    data class HttpError(val code: Int) : MachinesResult()
    data class Failed(val message: String) : MachinesResult()
}

/** Pray PC 에 보내는 GET (HttpURLConnection, 의존성 없음). 메인 스레드에서 부르지 않는다 */
object PrayHttp {
    const val CONNECT_TIMEOUT_MS = 5_000

    /** WebView 가 받은 쿠키(메일 로그인 `jk_session`)를 같이 보낸다. 같은 Tailscale 계정이면 쿠키 없이도 열린다 */
    fun open(url: String, readTimeoutMs: Int): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = readTimeoutMs
        connection.useCaches = false
        cookieFor(url)?.let { connection.setRequestProperty("Cookie", it) }
        return connection
    }

    private fun cookieFor(url: String): String? = try {
        CookieManager.getInstance().getCookie(url)
    } catch (error: Throwable) {
        // WebView 가 없는 기기·초기화 실패
        null
    }

    fun fetchMachines(baseUrl: String): MachinesResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = open("$baseUrl/api/machines", 15_000)
            connection.setRequestProperty("Accept", "application/json")
            val code = connection.responseCode
            if (code != 200) return MachinesResult.HttpError(code)
            val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            Machines.parsePayload(text)?.let { MachinesResult.Ok(it) } ?: MachinesResult.Failed("Not a Pray server")
        } catch (error: IOException) {
            MachinesResult.Failed(error.message ?: error.javaClass.simpleName)
        } catch (error: RuntimeException) {
            MachinesResult.Failed(error.message ?: error.javaClass.simpleName)
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * 저장한 PC 들에 차례로 물어(마지막에 본 PC 먼저) 처음 답한 목록으로 저장 목록을 고친다. 바뀌었으면 true.
     * 아무도 답하지 않으면 그대로 둔다
     */
    fun refreshMachines(store: MachineStore): Boolean {
        val previous = store.machines
        val last = store.lastMachine()
        val order = listOfNotNull(last) + previous.filter { it != last }
        for (machine in order) {
            val result = fetchMachines(machine.url)
            if (result !is MachinesResult.Ok) continue
            val next = Machines.merge(previous, result.listed)
            if (next == previous) return false
            store.machines = next
            return true
        }
        return false
    }
}
