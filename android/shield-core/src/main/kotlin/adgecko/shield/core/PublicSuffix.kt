package adgecko.shield.core

/**
 * Port of registrableDomain() and suffixReason() of src/threat/psl.js on the
 * exported psl.json (GeckoPublicSuffix.DATA). The order of the reason table
 * is the order of psl.js, so the reason strings are the same.
 */
class PublicSuffix private constructor(
    private val wildcardTlds: Set<String>,
    private val wildcardBases: Set<String>,
    private val icannExceptions: Set<String>,
    private val suffixes: Set<String>,
    private val privateSuffixes: Set<String>,
    private val privateWildcardBases: Set<String>,
    private val platforms: Set<String>,
    private val servicePlatforms: Set<String>,
    private val serviceHosts: List<String>,
) {
    private val reasons: Map<String, String> by lazy { buildTable() }

    private fun buildTable(): Map<String, String> {
        val r = HashMap<String, String>()
        for (s in suffixes) r[s] = "public suffix $s"
        for (s in privateSuffixes) r[s] = "public suffix $s"
        for (p in platforms) if (!r.containsKey(p)) r[p] = "shared platform $p"
        for (s in serviceHosts) if (!r.containsKey(s)) r[s] = "shared service host $s"
        for (name in suffixes.asSequence() + privateSuffixes.asSequence() + platforms.asSequence() + serviceHosts.asSequence()) {
            val labels = name.split('.')
            for (i in 1 until labels.size - 1) {
                val parent = labels.subList(i, labels.size).joinToString(".")
                if (!r.containsKey(parent)) r[parent] = "parent of " + r[name]
            }
        }
        return r
    }

    private fun ruleSuffix(h: String): Boolean {
        val labels = h.split('.')
        if (labels.size < 2 || icannExceptions.contains(h)) return false
        if (labels.size == 2) return wildcardTlds.contains(labels[1])
        return wildcardBases.contains(labels.subList(1, labels.size).joinToString("."))
    }

    /** null when the host may be blocked or allowed as a whole, else why not. */
    fun suffixReason(host: String): String? {
        val h = normalize(host)
        if (h.isEmpty() || !h.contains('.')) return "single label"
        reasons[h]?.let { return it }
        val labels = h.split('.')
        for (i in 1 until labels.size - 1) {
            val parent = labels.subList(i, labels.size).joinToString(".")
            if (servicePlatforms.contains(parent)) return "part of shared platform $parent"
        }
        if (ruleSuffix(h)) return "public suffix $h"
        if (labels.size >= 3 && privateWildcardBases.contains(labels.subList(1, labels.size).joinToString("."))) return "public suffix $h"
        return null
    }

    fun isIcannSuffix(host: String): Boolean {
        val h = normalize(host)
        return !h.contains('.') || suffixes.contains(h) || ruleSuffix(h)
    }

    fun isPublicSuffix(host: String): Boolean {
        val h = normalize(host)
        return isIcannSuffix(h) || privateSuffixes.contains(h)
    }

    fun registrableDomain(host: String): String {
        val h = normalize(host)
        val labels = h.split('.')
        if (labels.size < 2) return h
        for (i in 1 until labels.size) {
            val rest = labels.subList(i, labels.size).joinToString(".")
            if (isPublicSuffix(rest) || platforms.contains(rest)) return labels.subList(i - 1, labels.size).joinToString(".")
        }
        return labels.subList(labels.size - 2, labels.size).joinToString(".")
    }

    companion object {
        /** Same as normalize() of psl.js: trim, lower case, one trailing dot removed. */
        fun normalize(host: String): String {
            var h = JsText.trim(host).lowercase(java.util.Locale.ROOT)
            if (h.endsWith(".")) h = h.substring(0, h.length - 1)
            return h
        }

        @Suppress("UNCHECKED_CAST")
        fun fromJson(json: Any?): PublicSuffix {
            val d = json as? Map<String, Any?> ?: throw IllegalArgumentException("psl: not an object")
            fun list(k: String): List<String> = (d[k] as? List<Any?>)?.map { it as String } ?: throw IllegalArgumentException("psl: no $k")
            fun groups(k: String, into: LinkedHashSet<String>) {
                val g = d[k] as? Map<String, Any?> ?: throw IllegalArgumentException("psl: no $k")
                for ((parent, labels) in g) for (label in (labels as String).split(' ')) into += "$label.$parent"
            }
            val suffixes = LinkedHashSet(list("suffixes"))
            groups("icannDeep", suffixes)
            val privateSuffixes = LinkedHashSet(list("privateSuffixes"))
            groups("privateDeep", privateSuffixes)
            return PublicSuffix(
                wildcardTlds = list("wildcardTlds").toHashSet(),
                wildcardBases = list("wildcardBases").toHashSet(),
                icannExceptions = list("icannExceptions").toHashSet(),
                suffixes = suffixes,
                privateSuffixes = privateSuffixes,
                privateWildcardBases = list("privateWildcardBases").toHashSet(),
                platforms = LinkedHashSet(list("platforms")),
                servicePlatforms = list("servicePlatforms").toHashSet(),
                serviceHosts = list("serviceHosts"),
            )
        }
    }
}

/** JavaScript String.prototype.trim() white space (ECMAScript WhiteSpace and LineTerminator). */
object JsText {
    fun isJsSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000b', '\u000c', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }

    fun trim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isJsSpace(s[a])) a++
        while (b > a && isJsSpace(s[b - 1])) b--
        return s.substring(a, b)
    }
}
