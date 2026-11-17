// :shield-core: policy, data loading, DNS and IP packet code, vector runner.
// A Kotlin/JVM library with no Android classes (docs/android/PLAN.md 6.2).
// Its JVM tests run in the cloud container and in CI.
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
}

val repo = rootProject.layout.projectDirectory.dir("..")

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation(libs.junit)
}

// Real export plus samples.json for the parity tests (never committed).
val exportShieldSamples = tasks.register<ExportShieldData>("exportShieldSamples") {
    repoRoot.set(repo)
    script.set(repo.file("scripts/export-android-data.mjs"))
    sources.from(
        repo.dir("src/rules"),
        repo.dir("src/threat"),
        repo.dir("src/general"),
        repo.file("scripts/lib/android-dns-policy.mjs"),
        repo.file("LICENSE"),
        repo.file("src/LICENSE-EasyList.txt"),
    )
    samples.set(true)
    denoExecutable.set(providers.gradleProperty("adgecko.deno").orElse("deno"))
    outputDir.set(layout.buildDirectory.dir("generated/shield-samples"))
}

tasks.test {
    dependsOn(exportShieldSamples)
    val out = exportShieldSamples.flatMap { it.outputDir }
    inputs.dir(out)
    inputs.dir(repo.dir("test/fixtures/android/vectors"))
    maxHeapSize = "2g"
    doFirst {
        val dir = out.get().asFile
        systemProperty("adgecko.vectors", repo.dir("test/fixtures/android/vectors").asFile.absolutePath)
        systemProperty("adgecko.data", dir.resolve("shield").absolutePath)
        systemProperty("adgecko.samples", dir.resolve("samples.json").absolutePath)
    }
    testLogging {
        events("failed")
        showStandardStreams = true
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
