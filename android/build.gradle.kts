// Root build. The plugin versions come from gradle/libs.versions.toml.
// AGP 9 has built-in Kotlin support: :app and :probe do not apply
// org.jetbrains.kotlin.android. The Kotlin plugin on the classpath sets the
// Kotlin version for them (HANDOFF.md records the result of the first build).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}

// CI cache (OD-new-2): the device-test runner (UTP) of AGP comes from the
// configuration "unified-test-platform-gradle-work-action", which only the
// connected test tasks resolve. The build job runs this task, so the Gradle
// cache that it saves holds these files too, and the emulator jobs do not
// download them again from Maven Central (CI run 15: HTTP 429 on 6 attempts).
subprojects {
    pluginManager.withPlugin("com.android.application") {
        tasks.register("resolveDeviceTestTools") {
            group = "verification"
            description = "Downloads the device-test runner (UTP) into the Gradle cache."
            val utp: FileCollection = configurations.getByName("unified-test-platform-gradle-work-action")
            inputs.files(utp)
            doLast { logger.lifecycle("resolveDeviceTestTools: ${utp.files.size} files") }
        }
    }
}
