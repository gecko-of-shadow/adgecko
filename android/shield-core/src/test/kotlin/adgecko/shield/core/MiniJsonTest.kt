package adgecko.shield.core

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class MiniJsonTest {
    @Test
    fun readsValues() {
        val v = MiniJson.parse("""{"a":[1,-2,3.5,true,false,null,"x\u00e9\n"],"b":{}}""")
        assertEquals(mapOf("a" to listOf(1L, -2L, 3.5, true, false, null, "x\u00e9\n"), "b" to emptyMap<String, Any?>()), v)
    }

    @Test
    fun refusesBadText() {
        for (bad in listOf("", "{", "[1,]", "{\"a\":1,}", "01", "{\"a\":1,\"a\":2}", "\"a\u0001\"", "[1] x", "tru", "{a:1}", "1.", "-", "\"\\x\"")) {
            try {
                MiniJson.parse(bad)
                fail("accepted ${MiniJson.write(bad)}")
            } catch (e: MiniJson.JsonException) {
                // expected
            }
        }
    }

    @Test
    fun writesAsciiJson() {
        assertEquals("""{"k":["a\"b",1,null,"\u00e9"]}""", MiniJson.write(mapOf("k" to listOf("a\"b", 1L, null, "\u00e9"))))
    }
}
