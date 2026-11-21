package adgecko.shield.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class VectorsTest {
    @Test
    fun eachCommittedVectorFileHasARunnerAndPasses() {
        val files = TestData.vectors.listFiles()!!.filter { it.isFile }.sortedBy { it.name }
        assertTrue("no vector files", files.isNotEmpty())
        val psl = TestData.shieldData.psl
        val names = mutableListOf<String>()
        for (f in files) {
            // Closed set: an unknown file fails here.
            val r = VectorRunner.run(f.name, f.readBytes(), psl)
            assertEquals(r.cases, r.ran)
            println("vectors: ${f.name} ${r.ran} cases")
            names += f.name
        }
        assertEquals(VectorRunner.KNOWN.sorted(), names.sorted())
    }

    @Test
    fun anUnknownVectorFileFails() {
        try {
            VectorRunner.run("extra-unknown.json", """{"format":1,"kind":"extra-unknown","inputs":{},"cases":[]}""".toByteArray(), null)
            fail("an unknown vector file must fail")
        } catch (e: VectorRunner.UnknownVectorFile) {
            assertTrue(e.message!!.contains("extra-unknown.json"))
        }
    }

    @Test
    fun aChangedExpectedValueFails() {
        val f = TestData.vectors.resolve("dns-policy.json")
        val changed = f.readText().replaceFirst("\"action\":\"BLOCK\"", "\"action\":\"FORWARD\"")
        try {
            VectorRunner.run("dns-policy.json", changed.toByteArray(), null)
            fail("a changed case must fail")
        } catch (e: VectorRunner.Mismatch) {
            assertTrue(e.message!!.startsWith("dns-policy"))
        }
    }
}
