// :app, the Adgecko Shield APK (docs/android/PLAN.md section 6.2).
// No runtime library except the Kotlin standard library (plan 1.3).
// applicationId adgecko.shield is a placeholder (owner approval OD-2).
import com.android.build.api.artifact.SingleArtifact

plugins {
    alias(libs.plugins.android.application)
}

val repo = rootProject.layout.projectDirectory.dir("..")

// The source commit for the About screen (GPL-3.0 sections 5(d) and 6(d)).
// CI passes the head SHA of the pull request through the environment.
val sourceCommit: String = providers.environmentVariable("ADGECKO_SOURCE_SHA").orNull
    ?.takeIf { Regex("^[0-9a-f]{40}$").matches(it) } ?: "unknown"

android {
    namespace = "adgecko.shield"
    compileSdk = 36

    defaultConfig {
        applicationId = "adgecko.shield"
        minSdk = 33
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-m1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SOURCE_COMMIT", "\"$sourceCommit\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        // The committed vectors, for the vector runner on ART (assets path vectors/).
        getByName("androidTest").assets.directories.add(repo.dir("test/fixtures/android").asFile.path)
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkReleaseBuilds = false
        // Newer versions of AGP, Gradle or libraries are not an error in M1:
        // the versions are pinned by the plan (section 6.4).
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable", "OldTargetApi")
    }

    packaging {
        resources.excludes += setOf("META-INF/*.version", "kotlin/**", "DebugProbesKt.bin")
    }
}

dependencies {
    implementation(project(":shield-core"))
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}

// Export the data from src/rules/ into generated assets (assets path shield/).
val exportShieldData = tasks.register<ExportShieldData>("exportShieldData") {
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
    samples.set(false)
    denoExecutable.set(providers.gradleProperty("adgecko.deno").orElse("deno"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(exportShieldData, ExportShieldData::outputDir)

        val name = variant.name.replaceFirstChar { it.uppercase() }
        val exported = mutableSetOf(
            "adgecko.shield.ui.MainActivity",
            "adgecko.shield.vpn.ShieldVpnService",
            "adgecko.shield.tile.ShieldTileService",
        )
        if (variant.buildType == "debug") exported += "adgecko.shield.debug.DebugStartActivity"
        tasks.register<VerifyManifestPolicy>("verifyManifestPolicy$name") {
            group = "verification"
            description = "Checks the merged manifest of the ${variant.name} variant against the M1 policy."
            mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
            networkSecurityConfig.set(layout.projectDirectory.file("src/main/res/xml/network_security_config.xml"))
            expectedPermissions.set(
                setOf(
                    "android.permission.INTERNET",
                    "android.permission.ACCESS_NETWORK_STATE",
                    "android.permission.FOREGROUND_SERVICE",
                    "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED",
                    "android.permission.POST_NOTIFICATIONS",
                ),
            )
            expectedExported.set(exported)
            libraryAllowList.set(emptyList())
            report.set(layout.buildDirectory.file("reports/manifest-policy/${variant.name}.txt"))
        }
    }
}
