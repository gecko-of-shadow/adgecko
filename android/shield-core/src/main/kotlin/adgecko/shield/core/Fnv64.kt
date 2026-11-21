package adgecko.shield.core

/** 64-bit FNV-1a over the characters of a string (ASCII host names). */
object Fnv64 {
    const val OFFSET: Long = -0x340d631b7bdddcdbL // 0xcbf29ce484222325
    const val PRIME: Long = 0x100000001b3L

    fun hash(s: String, start: Int = 0, end: Int = s.length): Long {
        var h = OFFSET
        for (i in start until end) {
            h = h xor (s[i].code.toLong() and 0xff)
            h *= PRIME
        }
        return h
    }
}
