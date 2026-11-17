import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.SetProperty
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Checks the merged manifest of one variant (docs/android/PLAN.md section 6.3
 * and A9). It reads the AGP artifact MERGED_MANIFEST, so library additions
 * are visible. It fails the build on each deviation from the policy.
 *
 * This file holds the deny list. test/android-static.test.js does not scan
 * android/buildSrc/ for that reason.
 */
abstract class VerifyManifestPolicy : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val mergedManifest: RegularFileProperty

    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val networkSecurityConfig: RegularFileProperty

    /** The uses-permission set, exactly. */
    @get:Input
    abstract val expectedPermissions: SetProperty<String>

    /** Fully qualified names of the exported components, exactly. */
    @get:Input
    abstract val expectedExported: SetProperty<String>

    /**
     * Explicit allow list for elements that a library adds to the merged
     * manifest ("tag:name"). It is empty in M1: M1 has no runtime library.
     */
    @get:Input
    abstract val libraryAllowList: ListProperty<String>

    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun verify() {
        val problems = mutableListOf<String>()
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
            .newDocumentBuilder().parse(mergedManifest.get().asFile)
        val root = doc.documentElement
        val allowed = libraryAllowList.get().toSet()

        fun attr(e: Element, name: String): String? =
            e.getAttributeNS(ANDROID_NS, name).takeIf { e.hasAttributeNS(ANDROID_NS, name) }

        fun elements(parent: Element, tag: String): List<Element> {
            val list = parent.getElementsByTagName(tag)
            return (0 until list.length).map { list.item(it) as Element }
        }

        // Permissions.
        val permissions = mutableSetOf<String>()
        for (tag in listOf("uses-permission", "uses-permission-sdk-23")) {
            for (e in elements(root, tag)) permissions += attr(e, "name") ?: "?"
        }
        val expected = expectedPermissions.get()
        val extra = permissions - expected - allowed.filter { it.startsWith("uses-permission:") }.map { it.substringAfter(':') }.toSet()
        val missing = expected - permissions
        if (extra.isNotEmpty()) problems += "permissions not in the policy: $extra"
        if (missing.isNotEmpty()) problems += "permissions missing: $missing"
        for (p in permissions) if (p in FORBIDDEN_PERMISSIONS) problems += "forbidden permission: $p"

        // Declared custom permissions (for example a library receiver permission).
        for (e in elements(root, "permission")) {
            val name = attr(e, "name") ?: "?"
            if ("permission:$name" !in allowed) problems += "declared permission not in the policy: $name"
        }

        // Application attributes.
        val app = elements(root, "application").singleOrNull()
        if (app == null) {
            problems += "no single application element"
        } else {
            if (attr(app, "allowBackup") != "false") problems += "android:allowBackup must be false"
            if (attr(app, "usesCleartextTraffic") != "false") problems += "android:usesCleartextTraffic must be false"
            if (attr(app, "networkSecurityConfig").isNullOrEmpty()) problems += "android:networkSecurityConfig is missing"
            if (attr(app, "dataExtractionRules").isNullOrEmpty()) problems += "android:dataExtractionRules is missing"

            // Components.
            val exported = mutableSetOf<String>()
            for (tag in listOf("activity", "activity-alias", "service", "receiver", "provider")) {
                for (e in elements(app, tag)) {
                    val name = attr(e, "name") ?: "?"
                    if ("$tag:$name" in allowed) continue
                    val permission = attr(e, "permission")
                    if (permission in FORBIDDEN_COMPONENT_PERMISSIONS) problems += "forbidden component type: $tag $name ($permission)"
                    if (tag == "receiver" || tag == "provider") problems += "$tag not in the policy: $name"
                    if (attr(e, "exported") == "true") {
                        exported += name
                        if (tag == "service" && permission.isNullOrEmpty()) problems += "exported service without a permission: $name"
                    }
                }
            }
            val expectedExp = expectedExported.get()
            if (exported != expectedExp) problems += "exported components ${exported.sorted()} != policy ${expectedExp.sorted()}"
            if (elements(app, "uses-library").isNotEmpty()) problems += "uses-library is not in the policy"
        }

        // Network security config: system certificates only, no cleartext.
        val nsc = networkSecurityConfig.get().asFile.readText()
        if (Regex("""src\s*=\s*"user"""").containsMatchIn(nsc)) problems += "network security config trusts user certificates"
        if (Regex("""cleartextTrafficPermitted\s*=\s*"true"""").containsMatchIn(nsc)) problems += "network security config permits cleartext"
        if (!Regex("""src\s*=\s*"system"""").containsMatchIn(nsc)) problems += "network security config has no system trust anchor"

        val out = report.get().asFile
        out.parentFile.mkdirs()
        if (problems.isNotEmpty()) {
            out.writeText("FAIL\n" + problems.joinToString("\n") + "\n")
            throw GradleException("Manifest policy failed:\n - " + problems.joinToString("\n - "))
        }
        out.writeText("PASS\npermissions=${permissions.sorted()}\n")
        logger.lifecycle("Manifest policy: PASS (${permissions.size} permissions)")
    }

    companion object {
        const val ANDROID_NS = "http://schemas.android.com/apk/res/android"

        val FORBIDDEN_PERMISSIONS = setOf(
            "android.permission.QUERY_ALL_PACKAGES",
            "android.permission.SYSTEM_ALERT_WINDOW",
            "android.permission.CAMERA",
            "android.permission.RECEIVE_BOOT_COMPLETED",
            "android.permission.READ_SMS",
            "android.permission.SEND_SMS",
            "android.permission.RECEIVE_SMS",
            "android.permission.READ_CONTACTS",
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_COARSE_LOCATION",
            "android.permission.READ_CLIPBOARD_IN_BACKGROUND",
            "android.permission.REQUEST_INSTALL_PACKAGES",
            "android.permission.MANAGE_EXTERNAL_STORAGE",
        )

        val FORBIDDEN_COMPONENT_PERMISSIONS = setOf(
            "android.permission.BIND_ACCESSIBILITY_SERVICE",
            "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
            "android.permission.BIND_INPUT_METHOD",
            "android.permission.BIND_DEVICE_ADMIN",
        )
    }
}
