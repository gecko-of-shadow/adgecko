package adgecko.shield.store

import adgecko.shield.core.MiniJson

/**
 * The allow list format of the Shield (docs/android/PLAN.md section 6.3):
 * {"format":1,"kind":"adgecko-allow-domains","threatAllowDomains":[...]},
 * the same entries and limit as threatAllowDomains of the extension (1,000).
 * Import also accepts a plain JSON array of strings. Each entry goes through
 * the validator (DomainRules.userDomainReason). Pure code: the JVM unit tests
 * of :app run it.
 */
object AllowListCodec {
    const val MAX_ENTRIES = 1000
    const val KIND = "adgecko-allow-domains"

    /** domain = the normalized name, or null and the reason. */
    data class Check(val domain: String?, val reason: String?)

    data class ImportResult(
        val domains: List<String>,
        val added: Int,
        val refused: List<Pair<String, String>>,
        val overLimit: Int,
    )

    class FormatException(message: String) : Exception(message)

    fun encode(domains: List<String>): String =
        MiniJson.write(linkedMapOf("format" to 1L, "kind" to KIND, "threatAllowDomains" to domains)) + "\n"

    /** Reads the entries of [text]. Throws FormatException on an unknown shape. */
    @Suppress("UNCHECKED_CAST")
    fun entries(text: String): List<Any?> {
        val v = try {
            MiniJson.parse(if (text.isNotEmpty() && text[0].code == 0xFEFF) text.substring(1) else text)
        } catch (e: IllegalArgumentException) {
            throw FormatException("not JSON: ${e.message}")
        }
        return when (v) {
            is List<*> -> v.toList()
            is Map<*, *> -> {
                if (v["kind"] != KIND) throw FormatException("unknown kind ${v["kind"]}")
                if (v["format"] != 1L) throw FormatException("unknown format ${v["format"]}")
                v["threatAllowDomains"] as? List<*> ?: throw FormatException("no threatAllowDomains array")
            }
            else -> throw FormatException("not an object or an array")
        }
    }

    /** Merges valid new entries into [existing], up to MAX_ENTRIES. */
    fun merge(existing: List<String>, incoming: List<Any?>, validate: (String) -> Check): ImportResult {
        val out = LinkedHashSet(existing)
        val refused = ArrayList<Pair<String, String>>()
        var added = 0
        var over = 0
        for (e in incoming) {
            val s = e as? String
            if (s == null) {
                refused += Pair(e.toString(), "not a string")
                continue
            }
            val c = validate(s)
            val d = c.domain
            if (d == null) {
                refused += Pair(s, c.reason ?: "refused")
                continue
            }
            if (d in out) continue
            if (out.size >= MAX_ENTRIES) {
                over++
                continue
            }
            out += d
            added++
        }
        return ImportResult(out.toList(), added, refused, over)
    }

    fun decodeApps(text: String): Set<String> {
        val v = try {
            MiniJson.parse(text)
        } catch (e: IllegalArgumentException) {
            return emptySet()
        }
        return (v as? List<*>)?.filterIsInstance<String>()?.filter { PACKAGE.matches(it) }?.toSortedSet() ?: emptySet()
    }

    fun encodeApps(apps: Set<String>): String = MiniJson.write(apps.sorted()) + "\n"

    private val PACKAGE = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
}
