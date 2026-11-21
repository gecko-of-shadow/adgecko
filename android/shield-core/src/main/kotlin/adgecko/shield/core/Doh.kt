package adgecko.shield.core

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URISyntaxException
import java.net.URL
import java.util.Locale
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * The DNS over HTTPS server of the user (RFC 8484). The path of the URL can
 * hold a private profile ID. Thus [toString] gives the host only, and code
 * must never log or show [text] (docs/android/shield.md section 7).
 */
class DohUrl private constructor(val text: String, val host: String) {
    override fun toString(): String = host

    /** The URL object for the connection. [text] is valid, so this does not throw. */
    fun toUrl(): URL = URL(text)

    companion object {
        const val MAX_LENGTH = 512

        /**
         * Reads an https URL, or returns null. The URL has 1 to 512 printable
         * ASCII characters, a host, no user info, no fragment, and no port or
         * a port from 1 to 65535. The scheme and the host are stored in lower case.
         */
        fun parse(input: String): DohUrl? {
            val s = input.trim()
            if (s.isEmpty() || s.length > MAX_LENGTH) return null
            for (c in s) if (c.code < 0x21 || c.code > 0x7e) return null
            val uri = try {
                URI(s)
            } catch (e: URISyntaxException) {
                return null
            }
            if (!"https".equals(uri.scheme, ignoreCase = true)) return null
            val host = uri.host?.lowercase(Locale.ROOT) ?: return null
            if (host.isEmpty() || uri.userInfo != null || uri.rawFragment != null) return null
            if (uri.port != -1 && uri.port !in 1..65535) return null
            return DohUrl("https" + s.substring(5), host)
        }
    }
}

/** The result of one DoH exchange. */
sealed class DohResult {
    /** [bytes] is the DNS answer with the DNS id of the client query. */
    class Answer(val bytes: ByteArray) : DohResult()

    /** [reason] is a short code. It never holds the URL or an exception message. */
    class Failed(val reason: String) : DohResult()
}

/**
 * One RFC 8484 POST exchange. [open] makes the connection. The app passes
 * Network.openConnection of the underlying network, so the host lookup and
 * the sockets do not use the VPN. The tests pass a loopback opener.
 *
 * The query goes out with DNS id 0 (RFC 8484 section 4.1), so an HTTP cache
 * can match equal queries. The answer must have id 0. The client id is put
 * back before the answer returns. The request has the fixed User-Agent
 * [USER_AGENT]: the Android default holds the device model and build ID.
 *
 * One total limit, the `timeoutMs` of [exchange], covers the whole exchange.
 * The connect and read timeouts of a connection apply to each step and to
 * each address of the host, so a [watchdog] task also calls disconnect() on
 * the connection when the total limit ends. The result is then
 * `Failed("timeout")` whatever exception the disconnect caused. The default
 * [watchdog] is one daemon thread for the whole process.
 *
 * Known limit: the host lookup inside [open] cannot be interrupted. An
 * exchange that waits there returns `Failed("timeout")` when the lookup ends.
 */
class DohClient(
    private val open: (URL) -> HttpURLConnection,
    private val watchdog: ScheduledExecutorService = SHARED_WATCHDOG,
) {
    fun exchange(url: DohUrl, query: ByteArray, timeoutMs: Int): DohResult {
        if (query.size < DnsMessage.HEADER) return DohResult.Failed(BAD_QUERY)
        if (timeoutMs <= 0) return DohResult.Failed(TIMEOUT)
        val body = query.copyOf()
        body[0] = 0
        body[1] = 0
        // RUNNING, then DONE (the whole body is read) or FIRED (the total limit ended).
        val state = AtomicInteger(RUNNING)
        val connection = AtomicReference<HttpURLConnection?>()
        val timer = watchdog.schedule(
            {
                if (state.compareAndSet(RUNNING, FIRED)) connection.get()?.let { runCatching { it.disconnect() } }
            },
            timeoutMs.toLong(),
            TimeUnit.MILLISECONDS,
        )
        var ok = false
        try {
            val c = open(url.toUrl())
            connection.set(c)
            if (state.get() == FIRED) {
                // The limit ended while open() ran: the watchdog found no connection to close.
                runCatching { c.disconnect() }
                return DohResult.Failed(TIMEOUT)
            }
            c.requestMethod = "POST"
            c.doOutput = true
            c.useCaches = false
            c.instanceFollowRedirects = false
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            c.setRequestProperty("User-Agent", USER_AGENT)
            c.setRequestProperty("Content-Type", MEDIA_TYPE)
            c.setRequestProperty("Accept", MEDIA_TYPE)
            c.setFixedLengthStreamingMode(body.size)
            // On Android, disconnect() does nothing before the HTTP engine exists, and
            // connect() creates it. So the watchdog can miss this window. Check after each step.
            c.connect()
            if (state.get() == FIRED) {
                runCatching { c.disconnect() }
                return DohResult.Failed(TIMEOUT)
            }
            c.outputStream.use { it.write(body) }
            if (state.get() == FIRED) return DohResult.Failed(TIMEOUT)
            val code = c.responseCode
            if (state.get() == FIRED) return DohResult.Failed(TIMEOUT)
            if (code != 200) {
                // Read the body, so the connection can serve the next request.
                c.errorStream?.use { drain(it, DRAIN_LIMIT, state) }
                return DohResult.Failed("HTTP $code")
            }
            val type = c.contentType?.substringBefore(';')?.trim()
            if (type == null || !type.equals(MEDIA_TYPE, ignoreCase = true)) {
                c.inputStream.close()
                return DohResult.Failed("content type")
            }
            if (c.contentLengthLong > MAX_ANSWER) {
                c.inputStream.close()
                return DohResult.Failed("too large")
            }
            val input = c.inputStream
            val answer = readLimited(input, MAX_ANSWER, state) ?: return DohResult.Failed("too large")
            // The body is complete. After this point the watchdog does nothing, so it
            // cannot close a connection that goes back to the keep-alive pool.
            if (!state.compareAndSet(RUNNING, DONE)) return DohResult.Failed(TIMEOUT)
            runCatching { input.close() }
            if (answer.size < DnsMessage.HEADER) return DohResult.Failed("too short")
            if (answer[0].toInt() != 0 || answer[1].toInt() != 0) return DohResult.Failed("bad id")
            answer[0] = query[0]
            answer[1] = query[1]
            ok = true
            return DohResult.Answer(answer)
        } catch (e: SocketTimeoutException) {
            return DohResult.Failed(TIMEOUT)
        } catch (e: IOException) {
            return DohResult.Failed(if (state.get() == FIRED) TIMEOUT else code(e))
        } catch (e: RuntimeException) {
            return DohResult.Failed(if (state.get() == FIRED) TIMEOUT else code(e))
        } finally {
            timer.cancel(false)
            // A good answer keeps the connection for the next request. After the total
            // limit the watchdog has called disconnect() already. A second call is
            // not needed, and on the JDK it can wait for the keep-alive cleaner (5 s).
            if (!ok && state.get() != FIRED) runCatching { connection.get()?.disconnect() }
        }
    }

    private fun code(e: Exception): String = e.javaClass.simpleName.ifEmpty { "error" }

    /**
     * All bytes of [s], or null when there are more than [limit] bytes. A
     * read that returns after the total limit ended throws, because
     * disconnect() does not always stop a read that has started.
     */
    private fun readLimited(s: InputStream, limit: Int, state: AtomicInteger): ByteArray? {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(4096)
        while (true) {
            val n = s.read(buf)
            if (state.get() == FIRED) throw SocketTimeoutException()
            if (n < 0) break
            if (out.size() + n > limit) return null
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    private fun drain(s: InputStream, limit: Int, state: AtomicInteger) {
        val buf = ByteArray(1024)
        var total = 0
        while (total < limit) {
            val n = s.read(buf)
            if (n < 0 || state.get() == FIRED) break
            total += n
        }
    }

    companion object {
        const val MEDIA_TYPE = "application/dns-message"
        const val USER_AGENT = "adgecko-shield"
        const val MAX_ANSWER = 65535
        const val TIMEOUT = "timeout"
        private const val DRAIN_LIMIT = 8192
        private const val BAD_QUERY = "bad query"
        private const val RUNNING = 0
        private const val DONE = 1
        private const val FIRED = 2

        /** One thread for all exchanges of the process. Cancelled tasks leave the queue at once. */
        private val SHARED_WATCHDOG: ScheduledExecutorService by lazy {
            ScheduledThreadPoolExecutor(1) { r -> Thread(r, "shield-doh-watchdog").apply { isDaemon = true } }
                .apply { removeOnCancelPolicy = true }
        }
    }
}

/**
 * A circuit breaker for the DoH server. Many threads can call it. The
 * caller passes a monotonic time.
 *
 * - Closed: DoH is tried. [failuresToOpen] failures in a row open it.
 * - Open: DoH is not tried until the time `until` ([openMs] after the
 *   failure that opened it).
 * - HalfOpen: at or after `until`, the first [tryAcquire] gets the one
 *   probe. Other callers get false until the probe ends. A probe success
 *   closes the breaker. A probe failure opens it again for [openMs].
 *
 * Each [tryAcquire] that returns true must end with exactly one [success] or
 * [failure]. Else a probe that never ends blocks DoH for good. A [failure]
 * while Open changes nothing (it is the late result of an older try).
 */
class DohBreaker(private val failuresToOpen: Int = 3, private val openMs: Long = 30_000) {
    private sealed interface State {
        class Closed(val failures: Int) : State
        class Open(val until: Long) : State
        object HalfOpen : State
    }

    private var state: State = State.Closed(0)

    @Synchronized
    fun tryAcquire(now: Long): Boolean = when (val s = state) {
        is State.Closed -> true
        is State.Open -> if (now >= s.until) {
            state = State.HalfOpen
            true
        } else {
            false
        }
        State.HalfOpen -> false
    }

    @Synchronized
    fun success() {
        state = State.Closed(0)
    }

    @Synchronized
    fun failure(now: Long) {
        state = when (val s = state) {
            is State.Closed -> if (s.failures + 1 >= failuresToOpen) State.Open(now + openMs) else State.Closed(s.failures + 1)
            is State.Open -> s
            State.HalfOpen -> State.Open(now + openMs)
        }
    }
}

/**
 * The counts of one Upstream that has a DoH URL. [host] is the host of that
 * URL (never the URL). [answers] came from DoH, [plain] queries went to the
 * plain path for any reason, and [lastReason] is the reason of the last query
 * that did not use DoH. While the breaker is open, every query sets
 * [lastReason] to "paused after failures". Thus [lastFailure] keeps the code
 * of the last real DoH failure, for example UnknownHostException or HTTP 404.
 * It is the check of the unverified premise that the Shield can reach the DoH
 * host. All reasons are short codes or phrases and never hold the URL or an
 * exception message.
 */
class DohStats(val host: String) {
    val answers = AtomicLong()
    val plain = AtomicLong()
    @Volatile var lastReason: String? = null
    @Volatile var lastFailure: String? = null
}

/**
 * The DoH decision for one forwarded query. [resolve] returns the DoH
 * answer, or null when the query must use the plain path. It counts both in
 * [stats]. Every exit that makes no try comes before
 * [DohBreaker.tryAcquire], so a half-open probe is never lost. [now] is a
 * monotonic clock in ms.
 */
class DohRoute(
    private val url: DohUrl,
    private val client: DohClient,
    val stats: DohStats,
    private val now: () -> Long,
    private val breaker: DohBreaker = DohBreaker(),
) {
    /**
     * [deadline] is the end of the whole query on the [now] clock. DoH gets
     * the time up to the deadline minus [FALLBACK_RESERVE_MS], at most
     * [DOH_TIMEOUT_MS], so the plain path keeps time. [plainPath] is true
     * when the caller has a DNS server to fall back to: only then the
     * query counts as plain.
     */
    fun resolve(query: ByteArray, deadline: Long, plainPath: Boolean): ByteArray? {
        if (dohSkipsName(DnsMessage.parseQuery(query)?.name, url.host)) return plain(REASON_HOST, plainPath)
        val t = now()
        val budget = deadline - t - FALLBACK_RESERVE_MS
        if (budget < MIN_DOH_MS) return plain(REASON_TIME, plainPath)
        if (!breaker.tryAcquire(t)) return plain(REASON_PAUSED, plainPath)
        var ended = false
        try {
            when (val r = client.exchange(url, query, minOf(DOH_TIMEOUT_MS.toLong(), budget).toInt())) {
                is DohResult.Answer -> {
                    breaker.success()
                    ended = true
                    // The client UDP size, and the largest IPv4 UDP payload: a larger
                    // answer would make IpPacket.buildUdp throw. The server works, so
                    // this is a success. The plain server sets the truncation flag.
                    if (r.bytes.size > minOf(DnsMessage.udpPayloadLimit(query), MAX_UDP_PAYLOAD)) {
                        return plain(REASON_LARGE, plainPath)
                    }
                    stats.answers.incrementAndGet()
                    return r.bytes
                }
                is DohResult.Failed -> {
                    breaker.failure(now())
                    ended = true
                    stats.lastFailure = r.reason
                    return plain(r.reason, plainPath)
                }
            }
        } finally {
            if (!ended) breaker.failure(now())
        }
    }

    private fun plain(reason: String, plainPath: Boolean): ByteArray? {
        if (plainPath) stats.plain.incrementAndGet()
        stats.lastReason = reason
        return null
    }

    companion object {
        /** The largest UDP payload in one IPv4 packet: 65,535 - 20 (IP header) - 8 (UDP header). */
        const val MAX_UDP_PAYLOAD = 65_507
        const val DOH_TIMEOUT_MS = 2500
        const val FALLBACK_RESERVE_MS = 1000L
        private const val MIN_DOH_MS = 500L
        const val REASON_HOST = "DoH host name"
        const val REASON_PAUSED = "paused after failures"
        const val REASON_TIME = "too little time left"
        const val REASON_LARGE = "answer larger than client limit"
    }
}

/**
 * True when a query must not go to the DoH server: the name equals the DoH
 * host (case-insensitive, one trailing dot ignored), or the query has no
 * name. The Shield then uses the plain path, so the lookup of the DoH host
 * cannot wait on DoH.
 */
fun dohSkipsName(name: String?, dohHost: String): Boolean {
    if (name == null) return true
    val n = name.removeSuffix(".").lowercase(Locale.ROOT)
    return n.isEmpty() || n == dohHost.removeSuffix(".").lowercase(Locale.ROOT)
}
