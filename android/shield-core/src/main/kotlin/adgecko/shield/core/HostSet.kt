package adgecko.shield.core

/**
 * A set of host names as a sorted LongArray of 64-bit FNV-1a hashes
 * (docs/android/PLAN.md section 6.3). matchSuffix() tests the host and each
 * parent suffix, also the top label (requestDomains meaning). A false match
 * needs a 64-bit hash collision.
 */
class HostSet private constructor(private val hashes: LongArray) {
    val size: Int get() = hashes.size

    /** Approximate heap bytes of the hash array. */
    val bytes: Long get() = hashes.size.toLong() * 8

    fun containsExact(host: String, start: Int = 0): Boolean =
        hashes.binarySearch(Fnv64.hash(host, start)) >= 0

    /** The suffix of [host] that is in the set, or null. [host] is normalized. */
    fun matchSuffix(host: String): String? {
        if (hashes.isEmpty()) return null
        val start = HostName.forEachSuffix(host) { containsExact(host, it) }
        return if (start >= 0) host.substring(start) else null
    }

    companion object {
        val EMPTY = HostSet(LongArray(0))

        fun of(hosts: Iterable<String>): HostSet {
            val list = ArrayList<Long>()
            for (h in hosts) list += Fnv64.hash(h)
            return fromHashes(list.toLongArray())
        }

        fun fromHashes(raw: LongArray): HostSet {
            raw.sort()
            var n = 0
            for (i in raw.indices) {
                if (n == 0 || raw[n - 1] != raw[i]) raw[n++] = raw[i]
            }
            return HostSet(if (n == raw.size) raw else raw.copyOf(n))
        }

        /**
         * Reads a host file: one host on each line, LF. It counts the lines.
         * Blank lines are refused (the export writes none).
         */
        fun parseLines(bytes: ByteArray): Pair<HostSet, Int> {
            var count = 0
            for (b in bytes) if (b == '\n'.code.toByte()) count++
            val raw = LongArray(count)
            var n = 0
            var h = Fnv64.OFFSET
            var len = 0
            for (b in bytes) {
                if (b == '\n'.code.toByte()) {
                    if (len == 0) throw IllegalArgumentException("blank line in a host file")
                    raw[n++] = h
                    h = Fnv64.OFFSET
                    len = 0
                } else {
                    h = h xor (b.toLong() and 0xff)
                    h *= Fnv64.PRIME
                    len++
                }
            }
            if (len != 0) throw IllegalArgumentException("host file has no final LF")
            return Pair(fromHashes(raw), count)
        }
    }
}
