// Root build. The plugin versions come from gradle/libs.versions.toml.
// AGP 9 has built-in Kotlin support: :app and :probe do not apply
// org.jetbrains.kotlin.android. The Kotlin plugin on the classpath sets the
// Kotlin version for them (HANDOFF.md records the result of the first build).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}
