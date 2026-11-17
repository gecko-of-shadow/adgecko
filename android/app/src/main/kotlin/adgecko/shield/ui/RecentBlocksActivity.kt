package adgecko.shield.ui

import adgecko.shield.core.Layer
import adgecko.shield.vpn.ShieldState
import android.app.Activity
import android.os.Bundle
import android.widget.LinearLayout
import java.text.DateFormat
import java.util.Date

/**
 * The last 200 blocked names with time and layer (memory only). A tap on a
 * row starts "Allow this domain" (two steps for a threat name).
 */
class RecentBlocksActivity : Activity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.screen(this, "Recent blocks")
        col.addView(Ui.text(this, "The last 200 blocked names, newest first. They stay in memory only. Tap a name to allow it."))
        col.addView(Ui.button(this, "Refresh") { fill() })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(list)
    }

    override fun onResume() {
        super.onResume()
        fill()
    }

    private fun fill() {
        list.removeAllViews()
        val items = ShieldState.recent.snapshot()
        if (items.isEmpty()) {
            list.addView(Ui.text(this, "No blocks yet."))
            return
        }
        val fmt = DateFormat.getTimeInstance(DateFormat.MEDIUM)
        for (e in items) {
            val threat = e.layer == Layer.THREAT
            val label = "${fmt.format(Date(e.timeMillis))}  ${e.host}\n    ${layerText(e.layer)}, type ${e.qtype}"
            list.addView(
                Ui.button(this, label) { AllowFlow.allow(this, e.host, threat) { fill() } }.apply {
                    textAlignment = android.view.View.TEXT_ALIGNMENT_VIEW_START
                },
            )
        }
    }

    private fun layerText(l: Layer) = when (l) {
        Layer.THREAT -> "malware list"
        Layer.LIST -> "ad and tracker list"
        Layer.SELF_TEST -> "Self-test"
        else -> l.name
    }
}
