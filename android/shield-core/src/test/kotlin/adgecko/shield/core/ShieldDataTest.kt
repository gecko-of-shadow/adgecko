package adgecko.shield.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.file.Files

class ShieldDataTest {
    @Test
    fun loadsTheRealExportAndChecksTheCounts() {
        val d = TestData.shieldData
        val manifest = File(TestData.data, "shield-manifest.json").readText()
        assertTrue(d.listCount in 185_000..205_000)
        assertTrue(d.threatCount in 10_000..20_000)
        assertTrue(manifest.contains("\"lines\": ${d.listCount}"))
        assertTrue(d.packedAtUtc.matches(Regex("""\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z""")))
        val p = DnsPolicy(d.policyData, Mode.ADS_AND_THREAT, false, emptyList())
        assertEquals(Layer.LIST, p.decide("imasdk.googleapis.com").layer)
        assertEquals(Layer.NEVER_BLOCK, p.decide("youtubei.googleapis.com").layer)
        assertEquals(Layer.SELF_TEST, p.decide("self-test.adgecko.test").layer)
        assertEquals(Layer.NONE, p.decide("nothing.shield.test").layer)
        assertNull(d.psl.suffixReason("me.github.io"))
    }

    private fun copyExport(): File {
        val tmp = Files.createTempDirectory("shield-data").toFile()
        TestData.data.walkTopDown().filter { it.isFile }.forEach { f ->
            val rel = f.relativeTo(TestData.data)
            val dst = File(tmp, rel.path)
            dst.parentFile.mkdirs()
            f.copyTo(dst)
        }
        return tmp
    }

    @Test
    fun refusesAChangedByte() {
        val tmp = copyExport()
        try {
            val f = File(tmp, "list-hosts.txt")
            val bytes = f.readBytes()
            bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 0x01).toByte()
            f.writeBytes(bytes)
            try {
                ShieldData.load(TestData.source(tmp))
                fail("a changed byte must fail the load")
            } catch (e: ShieldData.DataException) {
                assertTrue(e.message!!, e.message!!.contains("SHA-256"))
            }
        } finally {
            tmp.walkBottomUp().forEach { it.delete() }
        }
    }

    @Test
    fun refusesAShortFile() {
        val tmp = copyExport()
        try {
            val f = File(tmp, "threat-hosts.txt")
            f.writeBytes(f.readBytes().copyOf(f.length().toInt() - 1))
            try {
                ShieldData.load(TestData.source(tmp))
                fail("a short file must fail the load")
            } catch (e: ShieldData.DataException) {
                assertTrue(e.message!!.contains("bytes"))
            }
        } finally {
            tmp.walkBottomUp().forEach { it.delete() }
        }
    }
}
