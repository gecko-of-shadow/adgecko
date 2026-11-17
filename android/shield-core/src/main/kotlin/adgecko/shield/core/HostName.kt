package adgecko.shield.core

/**
 * Host name rules of the Shield (port of normalizeHost() and isIpLiteral() of
 * scripts/lib/android-dns-policy.mjs). A name that normalize() refuses never
 * matches a layer: the policy forwards it.
 */
object HostName {
    const val MAX_LENGTH = 253

    /**
     * Lower case, one trailing dot removed. null when the name is empty,
     * longer than 253 characters, has an empty label, or has a character
     * outside printable ASCII (0x21 to 0x7e).
     */
    fun normalize(input: String): String? {
        var h = input
        if (h.endsWith(".")) h = h.substring(0, h.length - 1)
        if (h.isEmpty() || h.length > MAX_LENGTH) return null
        var upper = false
        for (c in h) {
            if (c.code < 0x21 || c.code > 0x7e) return null
            if (c in 'A'..'Z') upper = true
        }
        if (upper) {
            val chars = CharArray(h.length) { i -> val c = h[i]; if (c in 'A'..'Z') c + 32 else c }
            h = String(chars)
        }
        if (h.startsWith(".") || h.endsWith(".") || h.contains("..")) return null
        return h
    }

    /** Dotted-quad IPv4 with parts 0 to 255, or any name with a colon (IPv6). */
    fun isIpLiteral(host: String): Boolean {
        if (host.indexOf(':') >= 0) return true
        val parts = host.split('.')
        if (parts.size != 4) return false
        for (p in parts) {
            if (p.isEmpty() || p.length > 3) return false
            for (c in p) if (c !in '0'..'9') return false
            if (p.toInt() > 255) return false
        }
        return true
    }

    /**
     * The start index of the host and of each parent: 0, then the index after
     * each dot. "a.b.c" gives 0, 2, 4.
     */
    inline fun forEachSuffix(host: String, action: (start: Int) -> Boolean): Int {
        var start = 0
        while (true) {
            if (action(start)) return start
            val dot = host.indexOf('.', start)
            if (dot < 0) return -1
            start = dot + 1
        }
    }
}
