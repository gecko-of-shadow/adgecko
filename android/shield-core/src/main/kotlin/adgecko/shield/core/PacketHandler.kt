package adgecko.shield.core

/** Where a forwarded answer goes back to. */
class ReturnInfo(val client: ByteArray, val alias: ByteArray, val clientPort: Int, val aliasPort: Int)

sealed class Outcome {
    class Reply(val bytes: ByteArray) : Outcome()

    class Forward(val query: ByteArray, val upstreamIndex: Int, val ret: ReturnInfo) : Outcome()

    object Drop : Outcome()
}

/**
 * The packet path of the Shield (docs/android/PLAN.md section 6.6). A pure
 * function of one packet: no I/O. The VPN routes only the alias addresses
 * into the interface, so each packet here goes to an alias.
 *
 * - UDP to an alias on port 53: a standard query with one question gets a
 *   decision. BLOCK gives a NODATA reply at once. FORWARD gives the DNS
 *   payload, unchanged, for the matching real server.
 * - TCP SYN to an alias on port 53 or 853: a RST+ACK, so that a TCP retry
 *   and the Private DNS probe fail fast (UNVERIFIED effect on a phone).
 * - All other packets: Drop.
 * - An internal error in the policy forwards the query (fail-open) and adds
 *   one to [errors].
 */
class PacketHandler(
    /** The alias addresses; the index is the index of the real DNS server. */
    private val aliases: List<ByteArray>,
    private val policy: () -> DnsPolicy?,
    private val serial: Long = 1,
    private val listener: Listener? = null,
) {
    fun interface Listener {
        fun onDecision(query: DnsQuery, decision: Decision)
    }

    @Volatile
    var errors: Long = 0
        private set

    private fun aliasIndex(addr: ByteArray): Int {
        for (i in aliases.indices) if (aliases[i].contentEquals(addr)) return i
        return -1
    }

    fun handle(buf: ByteArray, len: Int): Outcome {
        val p = try {
            IpPacket.parse(buf, len)
        } catch (e: RuntimeException) {
            null
        } ?: return Outcome.Drop
        val index = aliasIndex(p.dst)
        if (index < 0) return Outcome.Drop
        return try {
            when (p.protocol) {
                IpPacket.UDP -> udp(p, index)
                IpPacket.TCP -> tcp(p)
                else -> Outcome.Drop
            }
        } catch (e: RuntimeException) {
            Outcome.Drop
        }
    }

    private fun tcp(p: IpPacket): Outcome {
        val flags = p.tcpFlags() ?: return Outcome.Drop
        val port = p.dstPort()
        if (port != 53 && port != 853) return Outcome.Drop
        if (flags and IpPacket.TCP_SYN == 0 || flags and (IpPacket.TCP_ACK or IpPacket.TCP_RST) != 0) return Outcome.Drop
        return Outcome.Reply(IpPacket.buildTcpRstAck(p.dst, p.src, port, p.srcPort(), p.tcpSeq()))
    }

    private fun udp(p: IpPacket, index: Int): Outcome {
        if (p.dstPort() != 53) return Outcome.Drop
        val (off, dlen) = p.udpData() ?: return Outcome.Drop
        val q = DnsMessage.parseQuery(p.buf, off, dlen) ?: return Outcome.Drop
        val decision = try {
            val pol = policy()
            if (pol == null || q.name == null) DnsPolicy.NONE else pol.decide(q.name)
        } catch (e: RuntimeException) {
            errors++
            DnsPolicy.NONE
        }
        try {
            listener?.onDecision(q, decision)
        } catch (e: RuntimeException) {
            errors++
        }
        if (decision.action == Action.BLOCK) {
            return Outcome.Reply(IpPacket.buildUdp(p.dst, p.src, 53, p.srcPort(), DnsMessage.nodata(q, serial)))
        }
        return Outcome.Forward(p.buf.copyOfRange(off, off + dlen), index, ReturnInfo(p.src, p.dst, p.srcPort(), 53))
    }

    /** The UDP packet that carries an upstream [answer] back to the client. */
    fun forwardReply(ret: ReturnInfo, answer: ByteArray): ByteArray =
        IpPacket.buildUdp(ret.alias, ret.client, ret.aliasPort, ret.clientPort, answer)

    /** SERVFAIL for a forwarded [query] after a socket error or a timeout. Null for a bad query. */
    fun servfailReply(ret: ReturnInfo, query: ByteArray): ByteArray? {
        val q = DnsMessage.parseQuery(query) ?: return null
        return IpPacket.buildUdp(ret.alias, ret.client, ret.aliasPort, ret.clientPort, DnsMessage.servfail(q))
    }
}
