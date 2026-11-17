package adgecko.shield.core

/**
 * One parsed IPv4 or IPv6 packet with a UDP or TCP payload
 * (docs/android/PLAN.md section 6.3). parse() returns null for each packet
 * that the Shield drops: fragments, IPv6 extension headers, other protocols,
 * bad lengths, a bad IPv4 header checksum.
 */
class IpPacket(
    val version: Int,
    val src: ByteArray,
    val dst: ByteArray,
    val protocol: Int,
    val buf: ByteArray,
    /** Start of the transport header in [buf]. */
    val l4Offset: Int,
    /** Length of the transport header and data. */
    val l4Length: Int,
) {
    companion object {
        const val UDP = 17
        const val TCP = 6
        const val TCP_FIN = 0x01
        const val TCP_SYN = 0x02
        const val TCP_RST = 0x04
        const val TCP_ACK = 0x10

        private fun u16(b: ByteArray, i: Int) = ((b[i].toInt() and 0xff) shl 8) or (b[i + 1].toInt() and 0xff)

        fun parse(buf: ByteArray, len: Int = buf.size): IpPacket? {
            if (len < 1 || len > buf.size) return null
            return when ((buf[0].toInt() and 0xff) shr 4) {
                4 -> parse4(buf, len)
                6 -> parse6(buf, len)
                else -> null
            }
        }

        private fun parse4(b: ByteArray, len: Int): IpPacket? {
            if (len < 20) return null
            val ihl = (b[0].toInt() and 0x0f) * 4
            if (ihl < 20 || ihl > len) return null
            val total = u16(b, 2)
            if (total < ihl || total > len) return null
            if (u16(b, 6) and 0x3fff != 0) return null // MF flag or fragment offset
            if (checksum(b, 0, ihl, 0L) != 0) return null
            val proto = b[9].toInt() and 0xff
            if (proto != UDP && proto != TCP) return null
            return IpPacket(4, b.copyOfRange(12, 16), b.copyOfRange(16, 20), proto, b, ihl, total - ihl)
        }

        private fun parse6(b: ByteArray, len: Int): IpPacket? {
            if (len < 40) return null
            val payload = u16(b, 4)
            if (40 + payload > len) return null
            val next = b[6].toInt() and 0xff
            if (next != UDP && next != TCP) return null // extension headers and fragments are dropped
            return IpPacket(6, b.copyOfRange(8, 24), b.copyOfRange(24, 40), next, b, 40, payload)
        }

        /** One's-complement sum over [len] bytes from [off], plus [initial]. Returns the final 16-bit checksum. */
        fun checksum(b: ByteArray, off: Int, len: Int, initial: Long): Int {
            var sum = initial
            var i = off
            val end = off + len
            while (i + 1 < end) {
                sum += u16(b, i)
                i += 2
            }
            if (i < end) sum += (b[i].toInt() and 0xff) shl 8
            while (sum shr 16 != 0L) sum = (sum and 0xffff) + (sum shr 16)
            return (sum.inv() and 0xffff).toInt()
        }

        private fun pseudoSum(src: ByteArray, dst: ByteArray, proto: Int, l4len: Int): Long {
            var sum = 0L
            for (a in arrayOf(src, dst)) {
                var i = 0
                while (i < a.size) {
                    sum += u16(a, i)
                    i += 2
                }
            }
            sum += proto.toLong()
            sum += l4len.toLong()
            return sum
        }

        private fun ipHeader(src: ByteArray, dst: ByteArray, proto: Int, l4len: Int): ByteArray {
            return if (src.size == 4) {
                val h = ByteArray(20)
                h[0] = 0x45
                val total = 20 + l4len
                h[2] = (total shr 8).toByte()
                h[3] = total.toByte()
                h[6] = 0x40 // DF
                h[8] = 64
                h[9] = proto.toByte()
                src.copyInto(h, 12)
                dst.copyInto(h, 16)
                val c = checksum(h, 0, 20, 0L)
                h[10] = (c shr 8).toByte()
                h[11] = c.toByte()
                h
            } else {
                val h = ByteArray(40)
                h[0] = 0x60
                h[4] = (l4len shr 8).toByte()
                h[5] = l4len.toByte()
                h[6] = proto.toByte()
                h[7] = 64
                src.copyInto(h, 8)
                dst.copyInto(h, 24)
                h
            }
        }

        /** A UDP packet from [src]:[srcPort] to [dst]:[dstPort] with a valid checksum. */
        fun buildUdp(src: ByteArray, dst: ByteArray, srcPort: Int, dstPort: Int, data: ByteArray): ByteArray {
            require(src.size == dst.size && (src.size == 4 || src.size == 16))
            val l4len = 8 + data.size
            require(l4len <= 0xffff)
            val ip = ipHeader(src, dst, UDP, l4len)
            val out = ByteArray(ip.size + l4len)
            ip.copyInto(out)
            val u = ip.size
            out[u] = (srcPort shr 8).toByte()
            out[u + 1] = srcPort.toByte()
            out[u + 2] = (dstPort shr 8).toByte()
            out[u + 3] = dstPort.toByte()
            out[u + 4] = (l4len shr 8).toByte()
            out[u + 5] = l4len.toByte()
            data.copyInto(out, u + 8)
            var c = checksum(out, u, l4len, pseudoSum(src, dst, UDP, l4len))
            if (c == 0) c = 0xffff
            out[u + 6] = (c shr 8).toByte()
            out[u + 7] = c.toByte()
            return out
        }

        /** A TCP RST+ACK from [src]:[srcPort] to [dst]:[dstPort] that answers a SYN with sequence [synSeq]. */
        fun buildTcpRstAck(src: ByteArray, dst: ByteArray, srcPort: Int, dstPort: Int, synSeq: Long): ByteArray {
            val ip = ipHeader(src, dst, TCP, 20)
            val out = ByteArray(ip.size + 20)
            ip.copyInto(out)
            val t = ip.size
            out[t] = (srcPort shr 8).toByte()
            out[t + 1] = srcPort.toByte()
            out[t + 2] = (dstPort shr 8).toByte()
            out[t + 3] = dstPort.toByte()
            val ack = (synSeq + 1) and 0xffffffffL
            out[t + 8] = (ack shr 24).toByte()
            out[t + 9] = (ack shr 16).toByte()
            out[t + 10] = (ack shr 8).toByte()
            out[t + 11] = ack.toByte()
            out[t + 12] = 0x50
            out[t + 13] = (TCP_RST or TCP_ACK).toByte()
            val c = checksum(out, t, 20, pseudoSum(src, dst, TCP, 20))
            out[t + 16] = (c shr 8).toByte()
            out[t + 17] = c.toByte()
            return out
        }

        /** True when the transport checksum of [p] is valid (tests). */
        fun transportChecksumOk(p: IpPacket): Boolean =
            checksum(p.buf, p.l4Offset, p.l4Length, pseudoSum(p.src, p.dst, p.protocol, p.l4Length)) == 0
    }

    fun srcPort(): Int = u16(buf, l4Offset)

    fun dstPort(): Int = u16(buf, l4Offset + 2)

    /** UDP: the data offset and length, or null when the UDP header is bad. */
    fun udpData(): Pair<Int, Int>? {
        if (protocol != UDP || l4Length < 8) return null
        val ulen = u16(buf, l4Offset + 4)
        if (ulen < 8 || ulen > l4Length) return null
        return Pair(l4Offset + 8, ulen - 8)
    }

    fun tcpFlags(): Int? = if (protocol == TCP && l4Length >= 20) buf[l4Offset + 13].toInt() and 0xff else null

    fun tcpSeq(): Long = (u16(buf, l4Offset + 4).toLong() shl 16) or u16(buf, l4Offset + 6).toLong()
}
