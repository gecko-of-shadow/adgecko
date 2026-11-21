// Adgecko Shield (docs/android/PLAN.md section 6.2). Run from the repository
// root: ./android/gradlew -p android --no-daemon <tasks>
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "adgecko-shield"
include(":shield-core", ":app", ":probe")
