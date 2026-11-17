package adgecko.shield

import adgecko.shield.core.PublicSuffix
import adgecko.shield.core.MiniJson
import adgecko.shield.core.ShieldData
import adgecko.shield.core.VectorRunner
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Plan E2: the same VectorRunner on ART, with the committed vector files
 * (androidTest assets, path vectors/) and the psl.json of the app assets.
 * Closed set: an unknown vector file fails.
 */
@RunWith(AndroidJUnit4::class)
class VectorsOnArtTest {
    @Test
    fun eachCommittedVectorFilePassesOnArt() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val testAssets = inst.context.assets
        val appAssets = inst.targetContext.assets
        val psl = PublicSuffix.fromJson(MiniJson.parse(appAssets.open("shield/psl.json").use { it.readBytes() }))
        val names = testAssets.list("vectors")!!.sorted()
        assertTrue("no vector files", names.isNotEmpty())
        for (name in names) {
            val r = VectorRunner.run(name, testAssets.open("vectors/$name").use { it.readBytes() }, psl)
            assertEquals(r.cases, r.ran)
            android.util.Log.i("AdgeckoShield", "art-vectors: $name ${r.ran} cases")
        }
        assertEquals(VectorRunner.KNOWN.sorted(), names)
    }

    @Test
    fun theBundledDataLoadsOnArt() {
        val appAssets = InstrumentationRegistry.getInstrumentation().targetContext.assets
        val t0 = System.nanoTime()
        val d = ShieldData.load { path -> appAssets.open("shield/$path").use { it.readBytes() } }
        val ms = (System.nanoTime() - t0) / 1_000_000
        android.util.Log.i("AdgeckoShield", "art-data: load $ms ms, ${d.listCount} list hosts, ${d.threatCount} threat names")
        assertTrue(d.listCount in 185_000..205_000)
        assertTrue(d.threatCount in 10_000..20_000)
    }
}
