package adgecko.shield.core

/**
 * A strict, small JSON reader (RFC 8259). M1 has no JSON library.
 * Objects become LinkedHashMap (key order kept), arrays List, numbers Long
 * when they are integers in range, else Double. A duplicate key, a trailing
 * comma, a leading zero, a raw control character or text after the value is
 * an error. Depth is limited to 64.
 */
object MiniJson {
    class JsonException(message: String) : IllegalArgumentException(message)

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.ws()
        val v = p.value(0)
        p.ws()
        if (p.i != text.length) throw JsonException("text after the value at ${p.i}")
        return v
    }

    fun parse(bytes: ByteArray): Any? = parse(String(bytes, Charsets.UTF_8))

    /** Compact JSON text. Strings are escaped; characters outside ASCII become \uXXXX. */
    fun write(v: Any?): String = StringBuilder().also { writeTo(it, v) }.toString()

    private fun writeTo(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is Boolean -> sb.append(v)
            is Int, is Long -> sb.append(v)
            is Double -> sb.append(if (v == Math.floor(v) && !v.isInfinite() && Math.abs(v) < 1e15) v.toLong().toString() else v.toString())
            is String -> {
                sb.append('"')
                for (c in v) {
                    when {
                        c == '"' -> sb.append("\\\"")
                        c == '\\' -> sb.append("\\\\")
                        c == '\n' -> sb.append("\\n")
                        c == '\r' -> sb.append("\\r")
                        c == '\t' -> sb.append("\\t")
                        c.code < 0x20 || c.code > 0x7e -> sb.append("\\u").append(String.format("%04x", c.code))
                        else -> sb.append(c)
                    }
                }
                sb.append('"')
            }
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, value) in v) {
                    if (!first) sb.append(',')
                    first = false
                    writeTo(sb, k as String)
                    sb.append(':')
                    writeTo(sb, value)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (x in v) {
                    if (!first) sb.append(',')
                    first = false
                    writeTo(sb, x)
                }
                sb.append(']')
            }
            else -> throw JsonException("cannot write ${v::class.java.simpleName}")
        }
    }

    private class Parser(val s: String) {
        var i = 0

        fun fail(msg: String): Nothing = throw JsonException("$msg at $i")

        fun ws() {
            while (i < s.length) {
                val c = s[i]
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++ else break
            }
        }

        fun value(depth: Int): Any? {
            if (depth > 64) fail("too deep")
            if (i >= s.length) fail("end of text")
            return when (val c = s[i]) {
                '{' -> obj(depth)
                '[' -> arr(depth)
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else fail("unexpected '$c'")
            }
        }

        fun lit(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) fail("bad literal")
            i += word.length
            return v
        }

        fun obj(depth: Int): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            i++
            ws()
            if (i < s.length && s[i] == '}') { i++; return m }
            while (true) {
                ws()
                if (i >= s.length || s[i] != '"') fail("expected a key")
                val k = str()
                ws()
                if (i >= s.length || s[i] != ':') fail("expected ':'")
                i++
                ws()
                if (m.containsKey(k)) fail("duplicate key \"$k\"")
                m[k] = value(depth + 1)
                ws()
                if (i >= s.length) fail("end of text in an object")
                when (s[i]) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> fail("expected ',' or '}'")
                }
            }
        }

        fun arr(depth: Int): List<Any?> {
            val a = ArrayList<Any?>()
            i++
            ws()
            if (i < s.length && s[i] == ']') { i++; return a }
            while (true) {
                ws()
                a += value(depth + 1)
                ws()
                if (i >= s.length) fail("end of text in an array")
                when (s[i]) {
                    ',' -> i++
                    ']' -> { i++; return a }
                    else -> fail("expected ',' or ']'")
                }
            }
        }

        fun str(): String {
            i++
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) fail("end of text in a string")
                val c = s[i++]
                when {
                    c == '"' -> return sb.toString()
                    c == '\\' -> {
                        if (i >= s.length) fail("end of text in an escape")
                        when (val e = s[i++]) {
                            '"' -> sb.append('"')
                            '\\' -> sb.append('\\')
                            '/' -> sb.append('/')
                            'b' -> sb.append('\b')
                            'f' -> sb.append('\u000c')
                            'n' -> sb.append('\n')
                            'r' -> sb.append('\r')
                            't' -> sb.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) fail("short \\u escape")
                                var code = 0
                                for (k in 0 until 4) {
                                    val d = Character.digit(s[i + k], 16)
                                    if (d < 0) fail("bad \\u escape")
                                    code = code * 16 + d
                                }
                                i += 4
                                sb.append(code.toChar())
                            }
                            else -> fail("bad escape '\\$e'")
                        }
                    }
                    c.code < 0x20 -> fail("raw control character in a string")
                    else -> sb.append(c)
                }
            }
        }

        fun num(): Any {
            val start = i
            if (s[i] == '-') i++
            if (i >= s.length) fail("bad number")
            if (s[i] == '0') {
                i++
            } else if (s[i] in '1'..'9') {
                while (i < s.length && s[i] in '0'..'9') i++
            } else fail("bad number")
            var integer = true
            if (i < s.length && s[i] == '.') {
                integer = false
                i++
                if (i >= s.length || s[i] !in '0'..'9') fail("bad fraction")
                while (i < s.length && s[i] in '0'..'9') i++
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                integer = false
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                if (i >= s.length || s[i] !in '0'..'9') fail("bad exponent")
                while (i < s.length && s[i] in '0'..'9') i++
            }
            val text = s.substring(start, i)
            if (integer) text.toLongOrNull()?.let { return it }
            return text.toDouble()
        }
    }
}
