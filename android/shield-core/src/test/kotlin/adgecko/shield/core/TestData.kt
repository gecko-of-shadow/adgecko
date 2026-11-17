package adgecko.shield.core

import java.io.File

/** Paths from the Gradle test task (shield-core/build.gradle.kts). */
object TestData {
    fun dir(prop: String): File {
        val p = System.getProperty(prop) ?: throw IllegalStateException("system property $prop is not set; run the tests with Gradle")
        return File(p)
    }

    val vectors: File get() = dir("adgecko.vectors")
    val data: File get() = dir("adgecko.data")
    val samples: File get() = dir("adgecko.samples")

    fun source(root: File) = FileSource { path -> File(root, path).readBytes() }

    val shieldData: ShieldData by lazy { ShieldData.load(source(data)) }
}
