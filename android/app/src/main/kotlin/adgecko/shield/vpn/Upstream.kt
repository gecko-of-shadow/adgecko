package adgecko.shield.vpn

import android.net.Network
import android.net.VpnService
import android.os.SystemClock
import java.net.DatagramPacket
import java.net.DatagramSocket
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
 */
class Upstream(
    private val service: VpnService,
    val network: Network?,
    val servers: List<InetAddress>,
) {
    private val pool = ThreadPoolExecutor(
        THREADS, THREADS, 30, TimeUnit.SECONDS, ArrayBlockingQueue(QUEUE),
    ) { r -> Thread(r, "shield-upstream").apply { isDaemon = true } }

    fun interface Callback {
        /** answer is null on a socket error, a timeout or a full queue. */
        fun done(answer: ByteArray?)
    }

    fun send(index: Int, query: ByteArray, callback: Callback) {
        val server = servers.getOrNull(index)
        if (server == null || query.size < 2) {
            callback.done(null)
            return
        }
        val queued = SystemClock.elapsedRealtime()
        try {
            pool.execute {
                val deadline = queued + TIMEOUT_MS
                callback.done(if (SystemClock.elapsedRealtime() >= deadline) null else exchange(server, query, deadline))
            }
        } catch (e: RejectedExecutionException) {
            callback.done(null)
        }
    }

    private fun exchange(server: InetAddress, query: ByteArray, deadline: Long): ByteArray? {
        val s = try {
            DatagramSocket()
        } catch (e: Exception) {
            return null
        }
        try {
            if (!service.protect(s)) return null
            network?.bindSocket(s)
            s.connect(InetSocketAddress(server, 53))
            s.send(DatagramPacket(query, query.size))
            val buf = ByteArray(MAX_ANSWER)
            while (true) {
                val left = deadline - SystemClock.elapsedRealtime()
                if (left <= 0) return null
                s.soTimeout = left.toInt()
                val p = DatagramPacket(buf, buf.size)
                s.receive(p)
                // Same DNS id as the query, else wait for the next packet.
                if (p.length >= 2 && buf[0] == query[0] && buf[1] == query[1]) return buf.copyOf(p.length)
            }
        } catch (e: SocketTimeoutException) {
            return null
        } catch (e: Exception) {
            return null
        } finally {
            s.close()
        }
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
