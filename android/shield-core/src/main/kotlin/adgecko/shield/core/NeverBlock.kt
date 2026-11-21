package adgecko.shield.core

/**
 * Never-block layer {suffixes, except}: the same meaning as isNeverBlock() of
 * src/general/update.js. A host matches when it is a suffix or below one, and
 * it is not an except entry or below one (imasdk.googleapis.com stays
 * blockable).
 */
class NeverBlock(suffixes: Collection<String>, except: Collection<String>) {
    private val suffixes = HashSet(suffixes)
    private val except = HashSet(except)

    fun match(host: String): String? {
        if (suffixMatch(host, except) != null) return null
        return suffixMatch(host, suffixes)
    }

    companion object {
        fun suffixMatch(host: String, set: Set<String>): String? {
            if (set.isEmpty()) return null
            val start = HostName.forEachSuffix(host) { set.contains(host.substring(it)) }
            return if (start >= 0) host.substring(start) else null
        }

        @Suppress("UNCHECKED_CAST")
        fun fromJson(json: Any?): NeverBlock {
            val m = json as? Map<String, Any?> ?: throw IllegalArgumentException("never-block: not an object")
            val s = (m["suffixes"] as? List<Any?>)?.map { it as String } ?: throw IllegalArgumentException("never-block: no suffixes")
            val e = (m["except"] as? List<Any?>)?.map { it as String } ?: throw IllegalArgumentException("never-block: no except")
            return NeverBlock(s, e)
        }
    }
}
