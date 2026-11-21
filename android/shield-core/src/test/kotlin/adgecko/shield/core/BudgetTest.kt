package adgecko.shield.core

import org.junit.Assert.assertTrue
import org.junit.Test

/** Plan A8: rough JDK budgets. The phone values are UNVERIFIED. */
class BudgetTest {
    @Test
    fun loadLookupAndMemoryBudgets() {
        val t0 = System.nanoTime()
        val d = ShieldData.load(TestData.source(TestData.data))
        val loadMs = (System.nanoTime() - t0) / 1_000_000
        val p = DnsPolicy(d.policyData, Mode.ADS_AND_THREAT, false, listOf("allowed.example"))
        val hosts = Array(1000) { i -> if (i % 2 == 0) "host$i.sub.example.com" else "imasdk.googleapis.com" }
        repeat(20_000) { p.decide(hosts[it % 1000]) } // warm-up
        val t1 = System.nanoTime()
        var blocks = 0
        for (i in 0 until 1_000_000) if (p.decide(hosts[i % 1000]).action == Action.BLOCK) blocks++
        val lookupMs = (System.nanoTime() - t1) / 1_000_000
        val bytes = d.policyData.list.bytes + d.policyData.threat.bytes
        println("budget: load $loadMs ms, 1,000,000 lookups $lookupMs ms, host sets $bytes bytes, blocks $blocks")
        assertTrue("blocks $blocks", blocks == 500_000)
        assertTrue("1,000,000 lookups took $lookupMs ms", lookupMs < 2000)
        assertTrue("host sets use $bytes bytes", bytes < 4L * 1024 * 1024)
        assertTrue("load took $loadMs ms", loadMs < 1000)
    }
}
