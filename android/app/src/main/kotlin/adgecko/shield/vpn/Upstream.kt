package adgecko.shield.vpn

import android.net.Network
import android.net.VpnService
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The DNS servers of the real network (docs/android/PLAN.md section 6.3).
 * The code holds no resolver address: the servers come from the
 * LinkProperties of the best non-VPN network. Each query goes on a new
 * DatagramSocket that VpnService.protect() and Network.bindSocket() cover,
 * with a 5 s timeout, on a pool of 8 threads.
 */
class Upstream(
    private val service: VpnService,
    val network: Network?,
    val servers: List<InetAddress>,
) {
    private val pool: ExecutorService = Executors.newFixedThreadPool(8) { r -> Thread(r, "shield-upstream").apply { isDaemon = true } }

    fun interface Callback {
        /** answer is null on a socket error or a timeout. */
        fun done(answer: ByteArray?)
    }

    fun send(index: Int, query: ByteArray, callback: Callback) {
        val server = servers.getOrNull(index)
        if (server == null) {
            callback.done(null)
            return
        }
        try {
            pool.execute {
                var answer: ByteArray? = null
                try {
                    DatagramSocket().use { s ->
                        if (!service.protect(s)) throw IllegalStateException("protect() failed")
                        network?.bindSocket(s)
                        s.soTimeout = TIMEOUT_MS
                        s.send(DatagramPacket(query, query.size, InetSocketAddress(server, 53)))
                        val buf = ByteArray(4096)
                        val p = DatagramPacket(buf, buf.size)
                        while (true) {
                            s.receive(p)
                            // Same DNS id as the query, else wait for the next packet.
                            if (p.length >= 2 && buf[0] == query[0] && buf[1] == query[1]) break
                        }
                        answer = buf.copyOf(p.length)
                    }
                } catch (e: Exception) {
                    answer = null
                }
                callback.done(answer)
            }
        } catch (e: java.util.concurrent.RejectedExecutionException) {
            callback.done(null)
        }
    }

    fun close() {
        pool.shutdownNow()
    }

    companion object {
        const val TIMEOUT_MS = 5000
    }
}
