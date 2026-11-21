package adgecko.shield.vpn

import adgecko.shield.BuildConfig
import adgecko.shield.core.DohClient
import adgecko.shield.core.DohRoute
import adgecko.shield.core.DohStats
import adgecko.shield.core.DohUrl
import android.net.Network
import android.util.Log
import android.net.VpnService
import android.os.SystemClock
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The DNS servers of the real network (docs/android/PLAN.md section 6.3).
 * The code holds no resolver address: the servers come from the
 * LinkProperties of the best non-VPN network. Each query goes on a new
 * DatagramSocket that VpnService.protect() and Network.bindSocket() cover,
 * on a pool of 8 threads.
 *
 * Limits (review of 2026-11-17):
 * - The socket is connected to the server, so the kernel accepts answers
 *   from that server only. The answer must have the DNS id of the query.
 * - One total deadline of 5 s for each query, also when other datagrams come.
 * - The queue holds at most 64 queries. A full queue, or a query that waited
 *   longer than the deadline, gives SERVFAIL at once: a late answer is useless
 *   to the client, and it must not delay new queries.
 * - The receive buffer is 65,535 bytes, so a large answer is not cut.
 * - close() lets the running and queued queries finish; their answers go to
 *   the current interface (see ShieldVpnService.write).
 *
 * Optional DoH (docs/android/shield.md section 7). With a [doh] URL, a
 * forwarded query goes first to that URL (RFC 8484, POST); [DohRoute] decides.
 * The plain UDP path above serves the query when DoH fails, when the name is
 * the DoH host, when too little time is left, when the DoH answer is larger
 * than the client UDP size (or than 65,507 bytes), and while the circuit
 * breaker is open (3 failures in a row open it for 30 s, then one probe query
 * tries DoH again). The connection comes only from Network.openConnection of
 * the underlying [network]: that call resolves the host and binds the sockets
 * on that network, so the request does not enter the Shield. Without a
 * network, DoH is not used. The code never logs or shows the URL, only its
 * host. [dohStats] belongs to this Upstream: a new Upstream (a new URL, or a
 * rebuild) starts new counts, and a late result of an old one cannot change them.
 *
 * Known limits: the host lookup inside Network.openConnection cannot be
 * interrupted, so a slow lookup can use more than the DoH time. A stale
 * keep-alive connection can cost one failed try.
 *
 * UNVERIFIED on a phone: the premise that the own package can resolve and
 * connect on the underlying network (the Shield has no allowBypass()). If the
 * premise is wrong, the "via network DNS" count on the main screen goes up and
 * the screen shows the last DoH failure code (DohStats.lastFailure).
 */
class Upstream(
    private val service: VpnService,
    val network: Network?,
    val servers: List<InetAddress>,
    private val doh: DohUrl? = null,
) {
    /** The counts of this Upstream. Null without a DoH URL. */
    val dohStats: DohStats? = if (doh != null) DohStats(doh.host) else null

    private val dohRoute: DohRoute? =
        if (doh != null && network != null && dohStats != null) {
            DohRoute(
                doh,
                DohClient({ url -> network.openConnection(url) as HttpURLConnection }),
                dohStats,
                { SystemClock.elapsedRealtime() },
            )
        } else {
            null
        }

    private val pool = ThreadPoolExecutor(
        THREADS, THREADS, 30, TimeUnit.SECONDS, ArrayBlockingQueue(QUEUE),
    ) { r -> Thread(r, "shield-upstream").apply { isDaemon = true } }

    fun interface Callback {
        /** answer is null on a socket error, a timeout or a full queue. */
        fun done(answer: ByteArray?)
    }

    fun send(index: Int, query: ByteArray, callback: Callback) {
        val server = servers.getOrNull(index)
        // Without a DNS server, only DoH can answer (a DoH URL with an IP address as host).
        if (query.size < 2 || (server == null && dohRoute == null)) {
            callback.done(null)
            return
        }
        val queued = SystemClock.elapsedRealtime()
        try {
            pool.execute {
                val deadline = queued + TIMEOUT_MS
                callback.done(if (SystemClock.elapsedRealtime() >= deadline) null else resolve(server, query, deadline))
            }
        } catch (e: RejectedExecutionException) {
            callback.done(null)
        }
    }

    /** DoH first when it can be used, then the plain path (also after a late DoH failure: exchange() checks the deadline). */
    private fun resolve(server: InetAddress?, query: ByteArray, deadline: Long): ByteArray? {
        dohRoute?.resolve(query, deadline, plainPath = server != null)?.let { return it }
        return if (server == null) null else exchange(server, query, deadline)
    }

    private fun exchange(server: InetAddress, query: ByteArray, deadline: Long): ByteArray? {
        // No time left (for example after a late DoH failure): send nothing.
        if (deadline - SystemClock.elapsedRealtime() <= 0) return fail("deadline before the query was sent", deadline)
        val s = try {
            DatagramSocket()
        } catch (e: Exception) {
            return null
        }
        try {
            if (!service.protect(s)) return fail("protect() refused", deadline)
            network?.bindSocket(s)
            s.connect(InetSocketAddress(server, 53))
            s.send(DatagramPacket(query, query.size))
            val buf = ByteArray(MAX_ANSWER)
            while (true) {
                val left = deadline - SystemClock.elapsedRealtime()
                if (left <= 0) return fail("deadline before an answer from server ${servers.indexOf(server)}", deadline)
                s.soTimeout = left.toInt()
                val p = DatagramPacket(buf, buf.size)
                s.receive(p)
                // Same DNS id as the query, else wait for the next packet.
                if (p.length >= 2 && buf[0] == query[0] && buf[1] == query[1]) return buf.copyOf(p.length)
            }
        } catch (e: SocketTimeoutException) {
            return fail("timeout, no answer from server ${servers.indexOf(server)}", deadline)
        } catch (e: Exception) {
            return fail("${e.javaClass.simpleName} for server ${servers.indexOf(server)}", deadline)
        } finally {
            s.close()
        }
    }

    /**
     * Debug builds log why a forward failed (no host name, only the server
     * index and the reason). CI run 13 (API 33): one forward got no answer in
     * 5 s, and the log could not show why.
     */
    private fun fail(reason: String, deadline: Long): ByteArray? {
        if (BuildConfig.DEBUG) {
            val late = SystemClock.elapsedRealtime() - (deadline - TIMEOUT_MS)
            Log.w(ShieldState.TAG, "upstream failed after $late ms: $reason (network=$network)")
        }
        return null
    }

    fun close() {
        pool.shutdown()
    }

    companion object {
        const val TIMEOUT_MS = 5000L
        const val THREADS = 8
        const val QUEUE = 64
        const val MAX_ANSWER = 65535
    }
}
