package adgecko.shield.core

import java.security.MessageDigest

/** Reads one file of the export by its path below "shield/". */
fun interface FileSource {
    fun read(path: String): ByteArray
}

/**
 * The bundled data (docs/android/PLAN.md section 4.4). load() reads
 * shield-manifest.json, checks the SHA-256, the byte count and the line count
 * of each file, and builds the host sets. A changed byte fails the load
 * (fail-closed: the app then shows the error and does not start the shield).
 */
class ShieldData private constructor(
    val serial: Long,
    val packedAtUtc: String,
    val parserVersion: Long,
    val listCount: Int,
    val threatCount: Int,
    val policyData: PolicyData,
    val psl: PublicSuffix,
    val files: List<FileEntry>,
) {
    data class FileEntry(val path: String, val sha256: String, val bytes: Long, val lines: Long)

    class DataException(message: String) : Exception(message)

    companion object {
        const val MANIFEST = "shield-manifest.json"
        const val PROJECTION = "whole-domain-v1"
        val REQUIRED = listOf("list-hosts.txt", "threat-hosts.txt", "never-block.json", "psl.json")

        fun sha256Hex(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

        @Suppress("UNCHECKED_CAST")
        fun load(source: FileSource): ShieldData {
            val manifest = MiniJson.parse(source.read(MANIFEST)) as? Map<String, Any?> ?: throw DataException("manifest is not an object")
            if (manifest["format"] != 1L || manifest["kind"] != "adgecko-shield-data") throw DataException("unknown manifest format")
            if (manifest["projection"] != PROJECTION) throw DataException("unknown projection ${manifest["projection"]}")
            val entries = (manifest["files"] as? List<Any?> ?: throw DataException("manifest has no files")).map {
                val m = it as Map<String, Any?>
                FileEntry(m["path"] as String, m["sha256"] as String, m["bytes"] as Long, m["lines"] as Long)
            }
            val byPath = entries.associateBy { it.path }
            for (r in REQUIRED) if (r !in byPath) throw DataException("manifest does not name $r")
            val content = HashMap<String, ByteArray>()
            for (e in entries) {
                if (e.path.contains("..") || e.path.startsWith("/")) throw DataException("bad path ${e.path}")
                val bytes = source.read(e.path)
                if (bytes.size.toLong() != e.bytes) throw DataException("${e.path}: ${bytes.size} bytes, manifest says ${e.bytes}")
                if (sha256Hex(bytes) != e.sha256) throw DataException("${e.path}: SHA-256 differs from the manifest")
                var lines = 0L
                for (b in bytes) if (b == '\n'.code.toByte()) lines++
                if (lines != e.lines) throw DataException("${e.path}: $lines lines, manifest says ${e.lines}")
                if (e.path in REQUIRED) content[e.path] = bytes
            }
            val (list, listLines) = HostSet.parseLines(content.getValue("list-hosts.txt"))
            val (threat, threatLines) = HostSet.parseLines(content.getValue("threat-hosts.txt"))
            if (list.size != listLines || threat.size != threatLines) throw DataException("duplicate or colliding hosts in the host files")
            val neverBlock = NeverBlock.fromJson(MiniJson.parse(content.getValue("never-block.json")))
            val psl = PublicSuffix.fromJson(MiniJson.parse(content.getValue("psl.json")))
            return ShieldData(
                serial = manifest["serial"] as Long,
                packedAtUtc = manifest["packedAtUtc"] as String,
                parserVersion = manifest["parserVersion"] as Long,
                listCount = listLines,
                threatCount = threatLines,
                policyData = PolicyData(threat, neverBlock, list),
                psl = psl,
                files = entries,
            )
        }
    }
}
