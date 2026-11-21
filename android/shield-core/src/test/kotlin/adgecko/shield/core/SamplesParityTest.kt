package adgecko.shield.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Plan A5: Kotlin equals dnsDecision() on 100 % of the real-data samples. */
class SamplesParityTest {
    @Test
    @Suppress("UNCHECKED_CAST")
    fun kotlinEqualsTheJsReferenceOnEachSample() {
        val file = MiniJson.parse(TestData.samples.readBytes()) as Map<String, Any?>
        val allow = (file["userAllow"] as List<Any?>).map { it as String }
        val cases = (file["cases"] as List<Any?>).map { it as Map<String, Any?> }
        assertTrue("too few samples: ${cases.size}", cases.size >= 20_000)
        val data = TestData.shieldData.policyData
        val policies = HashMap<Pair<String, Boolean>, DnsPolicy>()
        var mismatches = 0
        val firstBad = mutableListOf<String>()
        for (c in cases) {
            val mode = c["mode"] as String
            val paused = c["paused"] as Boolean
            val p = policies.getOrPut(mode to paused) { DnsPolicy(data, Mode.of(mode), paused, allow) }
            val d = p.decide(c["host"] as String)
            if (d.action.name != c["action"] || d.layer.name != c["layer"]) {
                mismatches++
                if (firstBad.size < 10) firstBad += "${c["host"]} $mode $paused: $d"
            }
        }
        println("samples parity: ${cases.size} cases, $mismatches mismatches")
        assertEquals("mismatches: $firstBad", 0, mismatches)
    }
}
