package adgecko.shield.core

/**
 * Runs one committed vector file of test/fixtures/android/vectors/
 * (docs/android/PLAN.md section 6.5). The JVM tests of :shield-core and the
 * ART test of :app use this class. The set of runners is closed: a file with
 * no runner fails (UnknownVectorFile), so a new vector file needs a new
 * Kotlin runner. Each runner returns the number of cases that it ran; the
 * caller compares it with cases.size.
 */
object VectorRunner {
    val KNOWN = listOf("host-match.json", "never-block.json", "dns-policy.json", "public-suffix.json", "allow-domain.json")

    class UnknownVectorFile(name: String) : IllegalArgumentException("no Kotlin runner for vector file $name")

    class Mismatch(message: String) : AssertionError(message)

    data class Result(val name: String, val cases: Int, val ran: Int)

    @Suppress("UNCHECKED_CAST")
    fun run(name: String, bytes: ByteArray, psl: PublicSuffix?): Result {
        if (name !in KNOWN) throw UnknownVectorFile(name)
        val file = MiniJson.parse(bytes) as Map<String, Any?>
        check(file["format"] == 1L) { "$name: unknown format" }
        check(file["kind"] == name.removeSuffix(".json")) { "$name: kind ${file["kind"]}" }
        val inputs = file["inputs"] as Map<String, Any?>
        val cases = (file["cases"] as List<Any?>).map { it as Map<String, Any?> }
        val ran = when (name) {
            "host-match.json" -> hostMatch(inputs, cases)
            "never-block.json" -> neverBlock(inputs, cases)
            "dns-policy.json" -> dnsPolicy(inputs, cases)
            "public-suffix.json" -> publicSuffix(psl ?: throw IllegalStateException("$name needs psl.json"), cases)
            "allow-domain.json" -> allowDomain(psl ?: throw IllegalStateException("$name needs psl.json"), cases)
            else -> throw UnknownVectorFile(name)
        }
        if (ran != cases.size) throw Mismatch("$name: ran $ran of ${cases.size} cases")
        return Result(name, cases.size, ran)
    }

    private fun expect(ok: Boolean, what: () -> String) {
        if (!ok) throw Mismatch(what())
    }

    @Suppress("UNCHECKED_CAST")
    private fun strings(v: Any?): List<String> = (v as List<Any?>).map { it as String }

    private fun hostMatch(inputs: Map<String, Any?>, cases: List<Map<String, Any?>>): Int {
        val set = HostSet.of(strings(inputs["set"]))
        var n = 0
        for (c in cases) {
            val host = c["host"] as String
            val norm = HostName.normalize(host)
            expect(norm == c["normalized"]) { "host-match normalize ${quote(host)}: $norm" }
            val ip = norm != null && HostName.isIpLiteral(norm)
            expect(ip == c["ip"]) { "host-match ip ${quote(host)}: $ip" }
            val m = if (norm == null) null else set.matchSuffix(norm)
            expect(m == c["match"]) { "host-match ${quote(host)}: $m" }
            n++
        }
        return n
    }

    private fun neverBlock(inputs: Map<String, Any?>, cases: List<Map<String, Any?>>): Int {
        val nb = NeverBlock(strings(inputs["suffixes"]), strings(inputs["except"]))
        var n = 0
        for (c in cases) {
            val host = c["host"] as String
            val norm = HostName.normalize(host)
            val got = norm != null && nb.match(norm) != null
            expect(got == c["neverBlock"]) { "never-block ${quote(host)}: $got" }
            n++
        }
        return n
    }

    @Suppress("UNCHECKED_CAST")
    private fun dnsPolicy(inputs: Map<String, Any?>, cases: List<Map<String, Any?>>): Int {
        val nb = inputs["neverBlock"] as Map<String, Any?>
        val data = PolicyData(
            threat = HostSet.of(strings(inputs["threat"])),
            neverBlock = NeverBlock(strings(nb["suffixes"]), strings(nb["except"])),
            list = HostSet.of(strings(inputs["list"])),
        )
        val allow = strings(inputs["userAllow"])
        val policies = HashMap<Pair<Mode, Boolean>, DnsPolicy>()
        var n = 0
        for (c in cases) {
            val host = c["host"] as String
            val mode = Mode.of(c["mode"] as String)
            val paused = c["paused"] as Boolean
            val p = policies.getOrPut(mode to paused) { DnsPolicy(data, mode, paused, allow) }
            val d = p.decide(host)
            val ok = d.action.name == c["action"] && d.layer.name == c["layer"] && d.matched == c["matched"]
            expect(ok) { "dns-policy ${quote(host)} ${mode.id} paused=$paused: $d" }
            n++
        }
        return n
    }

    private fun publicSuffix(psl: PublicSuffix, cases: List<Map<String, Any?>>): Int {
        var n = 0
        for (c in cases) {
            val host = c["host"] as String
            val reg = psl.registrableDomain(host)
            val why = psl.suffixReason(host)
            expect(reg == c["registrableDomain"] && why == c["suffixReason"]) { "public-suffix ${quote(host)}: $reg / $why" }
            n++
        }
        return n
    }

    private fun allowDomain(psl: PublicSuffix, cases: List<Map<String, Any?>>): Int {
        val rules = DomainRules(psl)
        var n = 0
        for (c in cases) {
            val input = c["input"] as String
            val r = rules.userDomainReason(input)
            expect(r.domain == c["domain"] && r.reason == c["reason"]) { "allow-domain ${quote(input)}: $r" }
            n++
        }
        return n
    }

    private fun quote(s: String) = MiniJson.write(s)
}
