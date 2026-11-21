package adgecko.shield.core

/**
 * One DNS question of a standard query (RFC 1035). [labels] are the raw
 * label bytes. [name] is the dotted name, or null when a label holds a dot
 * or a byte outside printable ASCII (then the policy forwards the query).
 */
class DnsQuery(
    val id: Int,
    val flags: Int,
    val labels: List<ByteArray>,
    val name: String?,
    val qtype: Int,
    val qclass: Int,
)

/** The parts of a DNS response that the tests, the Self-test and the probe read. */
class DnsResponse(
    val id: Int,
    val flags: Int,
    val rcode: Int,
    val qdcount: Int,
    val ancount: Int,
    val nscount: Int,
    val arcount: Int,
    val answerTypes: List<Int>,
    val soaMname: String?,
    val soaTtl: Long,
    val soaMinimum: Long,
    val opt: Boolean,
)

/**
 * DNS message code of the Shield (docs/android/PLAN.md sections 6.3 and 6.6).
 * Name compression has a loop guard: at most 255 bytes of name and at most 32
 * jumps. The block answer is NODATA: RCODE 0, the question, no answer, one
 * SOA in the authority section with TTL 60, MNAME blocked.adgecko.invalid and
 * MINIMUM 60 (owner default OD-9).
 */
object DnsMessage {
    const val HEADER = 12
    const val TYPE_A = 1
    const val TYPE_SOA = 6
    const val TYPE_AAAA = 28
    const val TYPE_OPT = 41
    const val TYPE_SVCB = 64
    const val TYPE_HTTPS = 65
    const val CLASS_IN = 1
    const val BLOCK_TTL = 60L
    const val MNAME = "blocked.adgecko.invalid"
    const val RNAME = "hostmaster.adgecko.invalid"
    const val MAX_NAME = 255
    const val MAX_JUMPS = 32
    const val MIN_UDP = 512

    class Name(val labels: List<ByteArray>, val end: Int)

    private fun u16(b: ByteArray, i: Int) = ((b[i].toInt() and 0xff) shl 8) or (b[i + 1].toInt() and 0xff)

    private fun u32(b: ByteArray, i: Int) = (u16(b, i).toLong() shl 16) or u16(b, i + 2).toLong()

    /**
     * Reads a name at [start] of the message [b] (offset [off], length [len]).
     * Returns null on a bad name. Name.end is the position after the name in
     * the message (after the first pointer when the name is compressed).
     */
    fun readName(b: ByteArray, off: Int, len: Int, start: Int): Name? {
        val labels = ArrayList<ByteArray>()
        var pos = start
        var end = -1
        var jumps = 0
        var total = 1
        while (true) {
            if (pos >= len) return null
            val n = b[off + pos].toInt() and 0xff
            when (n and 0xc0) {
                0x00 -> {
                    if (n == 0) {
                        if (end < 0) end = pos + 1
                        return Name(labels, end)
                    }
                    if (pos + 1 + n > len) return null
                    total += n + 1
                    if (total > MAX_NAME) return null
                    labels += b.copyOfRange(off + pos + 1, off + pos + 1 + n)
                    pos += 1 + n
                }
                0xc0 -> {
                    if (pos + 2 > len) return null
                    if (++jumps > MAX_JUMPS) return null
                    if (end < 0) end = pos + 2
                    val target = ((n and 0x3f) shl 8) or (b[off + pos + 1].toInt() and 0xff)
                    if (target >= len) return null
                    pos = target
                }
                else -> return null
            }
        }
    }

    fun nameText(labels: List<ByteArray>): String? {
        val sb = StringBuilder()
        for ((k, l) in labels.withIndex()) {
            if (k > 0) sb.append('.')
            for (x in l) {
                val c = x.toInt() and 0xff
                if (c < 0x21 || c > 0x7e || c == '.'.code) return null
                sb.append(c.toChar())
            }
        }
        return sb.toString()
    }

    /** A standard query (QR 0, OPCODE 0) with exactly one question, else null. */
    fun parseQuery(b: ByteArray, off: Int = 0, len: Int = b.size): DnsQuery? {
        if (len < HEADER || off < 0 || off + len > b.size) return null
        val id = u16(b, off)
        val flags = u16(b, off + 2)
        if (flags and 0x8000 != 0) return null
        if ((flags shr 11) and 0xf != 0) return null
        if (u16(b, off + 4) != 1) return null
        val name = readName(b, off, len, HEADER) ?: return null
        if (name.end + 4 > len) return null
        val qtype = u16(b, off + name.end)
        val qclass = u16(b, off + name.end + 2)
        return DnsQuery(id, flags, name.labels, nameText(name.labels), qtype, qclass)
    }

    /**
     * The UDP payload size that the client accepts: the CLASS field of the
     * OPT record in the additional section of the [query] (RFC 6891), at
     * least 512. A query with no OPT record, or a bad query, gives 512.
     */
    fun udpPayloadLimit(query: ByteArray): Int {
        val len = query.size
        if (len < HEADER || u16(query, 4) != 1) return MIN_UDP
        val q = readName(query, 0, len, HEADER) ?: return MIN_UDP
        var pos = q.end + 4
        val records = u16(query, 6) + u16(query, 8) + u16(query, 10)
        val additionalFrom = u16(query, 6) + u16(query, 8)
        for (i in 0 until records) {
            val n = readName(query, 0, len, pos) ?: return MIN_UDP
            pos = n.end
            if (pos + 10 > len) return MIN_UDP
            val type = u16(query, pos)
            val rdlen = u16(query, pos + 8)
            if (i >= additionalFrom && type == TYPE_OPT) return maxOf(MIN_UDP, u16(query, pos + 2))
            pos += 10 + rdlen
            if (pos > len) return MIN_UDP
        }
        return MIN_UDP
    }

    private class Out {
        var a = ByteArray(128)
        var n = 0
        fun u8(v: Int) { ensure(1); a[n++] = v.toByte() }
        fun u16(v: Int) { u8(v shr 8); u8(v) }
        fun u32(v: Long) { u16((v shr 16).toInt() and 0xffff); u16(v.toInt() and 0xffff) }
        fun bytes(x: ByteArray) { ensure(x.size); x.copyInto(a, n); n += x.size }
        fun ensure(k: Int) { if (n + k > a.size) a = a.copyOf(maxOf(a.size * 2, n + k)) }
        fun name(labels: List<ByteArray>) { for (l in labels) { u8(l.size); bytes(l) }; u8(0) }
        fun result() = a.copyOf(n)
    }

    private fun textLabels(name: String) = name.split('.').map { it.toByteArray(Charsets.US_ASCII) }

    private fun header(o: Out, q: DnsQuery, rcode: Int, nscount: Int) {
        o.u16(q.id)
        o.u16(0x8000 or (q.flags and 0x0100) or 0x0080 or rcode)
        o.u16(1)
        o.u16(0)
        o.u16(nscount)
        o.u16(0)
        o.name(q.labels)
        o.u16(q.qtype)
        o.u16(q.qclass)
    }

    /** NODATA with one SOA (TTL 60) for each query type. [serial] is the data serial. */
    fun nodata(q: DnsQuery, serial: Long = 1): ByteArray {
        val o = Out()
        header(o, q, 0, 1)
        o.u16(0xc000 or HEADER)
        o.u16(TYPE_SOA)
        o.u16(CLASS_IN)
        o.u32(BLOCK_TTL)
        val rdata = Out()
        rdata.name(textLabels(MNAME))
        rdata.name(textLabels(RNAME))
        rdata.u32(serial and 0xffffffffL)
        rdata.u32(3600)
        rdata.u32(600)
        rdata.u32(86400)
        rdata.u32(BLOCK_TTL)
        val r = rdata.result()
        o.u16(r.size)
        o.bytes(r)
        return o.result()
    }

    fun servfail(q: DnsQuery): ByteArray {
        val o = Out()
        header(o, q, 2, 0)
        return o.result()
    }

    /** Builds a query (tests, Self-test fallback and probe). */
    fun query(id: Int, name: String, qtype: Int, edns: Boolean = false): ByteArray {
        val o = Out()
        o.u16(id)
        o.u16(0x0100)
        o.u16(1)
        o.u16(0)
        o.u16(0)
        o.u16(if (edns) 1 else 0)
        o.name(if (name.isEmpty()) emptyList() else textLabels(name))
        o.u16(qtype)
        o.u16(CLASS_IN)
        if (edns) {
            o.u8(0)
            o.u16(TYPE_OPT)
            o.u16(1232)
            o.u32(0)
            o.u16(0)
        }
        return o.result()
    }

    /** Reads a response. null on a malformed message. */
    fun parseResponse(b: ByteArray, off: Int = 0, len: Int = b.size): DnsResponse? {
        if (len < HEADER) return null
        val flags = u16(b, off + 2)
        val qd = u16(b, off + 4)
        val an = u16(b, off + 6)
        val ns = u16(b, off + 8)
        val ar = u16(b, off + 10)
        var pos = HEADER
        repeat(qd) {
            val n = readName(b, off, len, pos) ?: return null
            pos = n.end + 4
            if (pos > len) return null
        }
        val types = ArrayList<Int>()
        var mname: String? = null
        var soaTtl = -1L
        var soaMin = -1L
        var opt = false
        for (section in 0 until 3) {
            val count = when (section) { 0 -> an; 1 -> ns; else -> ar }
            repeat(count) {
                val n = readName(b, off, len, pos) ?: return null
                pos = n.end
                if (pos + 10 > len) return null
                val type = u16(b, off + pos)
                val ttl = u32(b, off + pos + 4)
                val rdlen = u16(b, off + pos + 8)
                val rd = pos + 10
                if (rd + rdlen > len) return null
                if (section == 0) types += type
                if (section == 1 && type == TYPE_SOA) {
                    val m = readName(b, off, len, rd) ?: return null
                    val r = readName(b, off, len, m.end) ?: return null
                    if (r.end + 20 > rd + rdlen) return null
                    mname = nameText(m.labels)
                    soaTtl = ttl
                    soaMin = u32(b, off + r.end + 16)
                }
                if (section == 2 && type == TYPE_OPT) opt = true
                pos = rd + rdlen
            }
        }
        return DnsResponse(u16(b, off), flags, flags and 0xf, qd, an, ns, ar, types, mname, soaTtl, soaMin, opt)
    }
}
