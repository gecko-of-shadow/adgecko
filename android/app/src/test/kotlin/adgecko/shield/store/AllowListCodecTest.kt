package adgecko.shield.store

import adgecko.shield.core.DomainRules
import adgecko.shield.core.MiniJson
import adgecko.shield.core.PublicSuffix
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Store and import logic of the allow list (plan T10). JVM only, no Android classes. */
class AllowListCodecTest {
    // A small PSL subset in the format of the exported psl.json.
    private val psl = PublicSuffix.fromJson(
        MiniJson.parse(
            """{"generic":[],"wildcardTlds":[],"wildcardBases":[],"icannExceptions":[],"suffixes":["com","uk","co.uk","io"],
               "icannDeep":{},"privateSuffixes":["github.io"],"privateDeep":{},"privateWildcardBases":[],
               "platforms":["platform.example"],"servicePlatforms":[],"serviceHosts":[]}""",
        ),
    )
    private val rules = DomainRules(psl)
    private val validate: (String) -> AllowListCodec.Check = { s -> rules.userDomainReason(s).let { AllowListCodec.Check(it.domain, it.reason) } }

    @Test
    fun exportHasTheExtensionFormatAndRoundTrips() {
        val text = AllowListCodec.encode(listOf("example.com", "me.github.io"))
        assertEquals("""{"format":1,"kind":"adgecko-allow-domains","threatAllowDomains":["example.com","me.github.io"]}""" + "\n", text)
        assertEquals(listOf("example.com", "me.github.io"), AllowListCodec.entries(text))
    }

    @Test
    fun importAcceptsAPlainArrayAndChecksEachEntry() {
        val incoming = AllowListCodec.entries("""["https://Shop.Example.co.uk/x", "github.io", "co.uk", "not a domain", 5, "example.com", "example.com."]""")
        val r = AllowListCodec.merge(listOf("example.com"), incoming, validate)
        assertEquals(listOf("example.com", "shop.example.co.uk"), r.domains)
        assertEquals(1, r.added)
        assertEquals(4, r.refused.size)
        assertTrue(r.refused.any { it.first == "github.io" && it.second == "public suffix github.io" })
        assertTrue(r.refused.any { it.first == "co.uk" && it.second == "public suffix co.uk" })
        assertTrue(r.refused.any { it.second == "not a string" })
    }

    @Test
    fun importRefusesNonAsciiInM1() {
        val r = AllowListCodec.merge(emptyList(), listOf("bücher.example"), validate)
        assertEquals(emptyList<String>(), r.domains)
        assertEquals(DomainRules.NOT_A_DOMAIN, r.refused.single().second)
    }

    @Test
    fun theListStopsAt1000Entries() {
        val many = (0 until 1005).map { "host$it.example" }
        val r = AllowListCodec.merge(emptyList(), many, validate)
        assertEquals(1000, r.domains.size)
        assertEquals(5, r.overLimit)
    }

    @Test
    fun unknownShapesAreRefused() {
        for (bad in listOf("{}", """{"kind":"other","format":1,"threatAllowDomains":[]}""", """{"kind":"adgecko-allow-domains","format":2,"threatAllowDomains":[]}""", "42", "not json")) {
            try {
                AllowListCodec.entries(bad)
                fail("accepted $bad")
            } catch (e: AllowListCodec.FormatException) {
                // expected
            }
        }
    }

    @Test
    fun excludedAppsKeepOnlyPackageNames() {
        val apps = AllowListCodec.decodeApps("""["com.example.app", "bad name", "a", "org.example.x_y"]""")
        assertEquals(setOf("com.example.app", "org.example.x_y"), apps)
        assertEquals("[\"com.example.app\",\"org.example.x_y\"]\n", AllowListCodec.encodeApps(apps))
        assertEquals(emptySet<String>(), AllowListCodec.decodeApps("{"))
    }
}
