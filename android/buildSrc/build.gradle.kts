// Build logic of Adgecko Shield: ExportShieldData and VerifyManifestPolicy.
// The tasks need only the Gradle API. :app connects VerifyManifestPolicy to
// the MERGED_MANIFEST artifact of the AGP variant API.
plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}
