package adgecko.shield.ui

import android.app.Activity
import android.graphics.Typeface
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Small view helpers. M1 has no AndroidX: the screens use platform views,
 * made in code. targetSdk 35+ draws edge to edge, so the root view applies
 * the system-bar insets as padding.
 */
object Ui {
    fun dp(a: Activity, v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), a.resources.displayMetrics).toInt()

    /** A vertical column in a ScrollView, set as the content view. Returns the column. */
    fun screen(a: Activity, title: String): LinearLayout {
        val col = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            val p = dp(a, 16)
            setPadding(p, p, p, p)
        }
        val scroll = ScrollView(a).apply {
            addView(col, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                WindowInsets.CONSUMED
            }
        }
        a.setContentView(scroll)
        a.title = title
        col.addView(heading(a, title, 22f))
        return col
    }

    fun heading(a: Activity, text: String, size: Float = 18f): TextView = TextView(a).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(a, 12), 0, dp(a, 6))
    }

    fun text(a: Activity, text: CharSequence = "", mono: Boolean = false): TextView = TextView(a).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (mono) 12f else 15f)
        if (mono) typeface = Typeface.MONOSPACE
        setTextIsSelectable(true)
        setPadding(0, dp(a, 4), 0, dp(a, 4))
    }

    fun button(a: Activity, label: String, onClick: (View) -> Unit): Button = Button(a).apply {
        text = label
        isAllCaps = false
        setOnClickListener(onClick)
    }

    fun row(a: Activity, vararg views: View): LinearLayout = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        for (v in views) addView(v, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    }
}
