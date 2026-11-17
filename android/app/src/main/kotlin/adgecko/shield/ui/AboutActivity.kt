package adgecko.shield.ui

import adgecko.shield.BuildConfig
import adgecko.shield.vpn.ShieldState
import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/**
 * About (docs/android/PLAN.md section 6.3; GPL-3.0 sections 5(d) and 6(d)):
 * the copyright lines of LICENSE, the no-warranty text, the source commit,
 * the data date, and the full licence and credit texts from the bundled
 * assets (shield/licenses/).
 */
class AboutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.screen(this, "About Adgecko Shield")
        val license = asset("licenses/LICENSE")
        val head = license.substringBefore("-----").trim()
        col.addView(Ui.text(this, head))
        val d = ShieldState.data
        col.addView(
            Ui.text(
                this,
                "Version ${BuildConfig.VERSION_NAME} (debug build).\n" +
                    "Source commit: ${BuildConfig.SOURCE_COMMIT}.\n" +
                    "Source code: the Adgecko repository, folder android/.\n" +
                    "Data: lists packed ${d?.packedAtUtc ?: "unknown"} (UTC), serial ${d?.serial ?: "unknown"}.\n" +
                    "No account, no analytics, no crash reporter. Recent blocks stay in memory only.",
            ),
        )
        for ((title, path) in listOf(
            "GNU General Public License version 3 (full text)" to "licenses/LICENSE",
            "Filter list licences (LICENSES.md)" to "licenses/LICENSES.md",
            "EasyList licence" to "licenses/LICENSE-EasyList.txt",
            "EasyList credit" to "licenses/CREDIT-EasyList.txt",
            "Public Suffix List notice" to "licenses/PSL-NOTICE.txt",
            "Kotlin Standard Library notice" to "licenses/KOTLIN-NOTICE.txt",
        )) {
            val body: TextView = Ui.text(this, "", mono = true)
            col.addView(Ui.button(this, title) { body.text = if (body.text.isEmpty()) asset(path) else "" })
            col.addView(body)
        }
    }

    private fun asset(path: String): String =
        runCatching { assets.open("shield/$path").use { String(it.readBytes(), Charsets.UTF_8) } }.getOrDefault("(missing: $path)")
}
