package adgecko.shield.core

/**
 * Port of userDomainReason() and normalizeUserDomain() of
 * src/threat/compile.js ("Allow this domain"). M1 accepts ASCII input only:
 * non-ASCII input is refused with "not a domain name" (fail-closed). IDN
 * parity comes in M2 on ART.
 */
class DomainRules(private val psl: PublicSuffix?) {
    data class Result(val domain: String?, val reason: String?)

    fun userDomainReason(input: String): Result {
        for (c in input) if (c.code > 0x7f) return Result(null, NOT_A_DOMAIN)
        var s = JsText.trim(input).lowercase(java.util.Locale.ROOT)
        s = SCHEME.replaceFirst(s, "")
        s = PATH.replaceFirst(s, "")
        s = PORT.replaceFirst(s, "")
        if (s.startsWith("*.")) s = s.substring(2)
        if (s.endsWith(".")) s = s.substring(0, s.length - 1)
        if (!HOST.matches(s)) return Result(null, NOT_A_DOMAIN)
        val p = psl ?: return Result(null, "public-suffix data not loaded")
        val why = p.suffixReason(s)
        return if (why != null) Result(null, why) else Result(s, null)
    }

    fun normalizeUserDomain(input: String): String? = userDomainReason(input).domain

    companion object {
        const val NOT_A_DOMAIN = "not a domain name"
        // \z, not $: in Java $ also matches before a final line end, in JS it does not.
        private val SCHEME = Regex("^[a-z][a-z0-9+.-]*://")
        private val PATH = Regex("[/?#].*\\z")
        private val PORT = Regex(":\\d+\\z")
        private val HOST = Regex("^(?=.{1,253}\\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\z")
    }
}
