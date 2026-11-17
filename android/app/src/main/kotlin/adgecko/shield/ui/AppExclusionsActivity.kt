package adgecko.shield.ui

import adgecko.shield.ShieldApp
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.CheckBox
import android.widget.LinearLayout

/**
 * "Exclude this app" (docs/android/PLAN.md section 6.3). It lists the
 * launcher apps through the queries element (MAIN + LAUNCHER), with no
 * QUERY_ALL_PACKAGES. An excluded app uses the normal DNS, with no filter.
 */
class AppExclusionsActivity : Activity() {
    private val store get() = (application as ShieldApp).store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.screen(this, "Exclude apps")
        col.addView(Ui.text(this, "The Shield does not filter the apps that you select. The change builds the VPN interface again."))
        val pm = packageManager
        val main = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(main, 0)
            .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != packageName }
            .distinctBy { it.first }
            .sortedBy { it.second.lowercase() }
        val excluded = store.excludedApps().toMutableSet()
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for ((pkg, label) in apps) {
            list.addView(
                CheckBox(this).apply {
                    text = "$label\n$pkg"
                    isChecked = pkg in excluded
                    setOnCheckedChangeListener { _, checked ->
                        if (checked) excluded += pkg else excluded -= pkg
                        store.setExcludedApps(excluded)
                        ShieldVpnService.command(this@AppExclusionsActivity, ShieldVpnService.ACTION_REBUILD)
                    }
                },
            )
        }
        col.addView(list)
    }
}
