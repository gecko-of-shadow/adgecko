// :probe, a debug-only app that is never shipped (docs/android/PLAN.md 6.2).
// Its instrumented test sends DNS queries through the Shield VPN from
// another app on the CI emulator (plan E3).
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "adgecko.shield.probe"
    compileSdk = 36

    defaultConfig {
        applicationId = "adgecko.shield.probe"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
    }
}

dependencies {
    androidTestImplementation(project(":shield-core"))
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.uiautomator)
}
