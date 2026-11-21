package adgecko.shield.ui

import adgecko.shield.ShieldApp
import adgecko.shield.store.AllowListCodec
import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The allow list (docs/android/PLAN.md section 6.3): remove an entry, add an
 * entry, export with ACTION_CREATE_DOCUMENT, import with ACTION_OPEN_DOCUMENT.
 * Format {"format":1,"kind":"adgecko-allow-domains","threatAllowDomains":[...]};
 * import also accepts a plain JSON array of strings. Max 1,000 entries.
 */
class AllowListActivity : Activity() {
    private lateinit var list: LinearLayout
    private lateinit var result: TextView
    private val listener: () -> Unit = { show() }
    private val store get() = (application as ShieldApp).store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.screen(this, "Allow list")
        col.addView(Ui.text(this, "The Shield does not block these names and their subdomains. Max ${AllowListCodec.MAX_ENTRIES} entries."))
        val input = EditText(this).apply { hint = "example.com"; isSingleLine = true }
        col.addView(input)
        col.addView(Ui.button(this, "Add") {
            val name = input.text.toString()
            AllowFlow.allow(this, name, threat = false) { input.setText(""); fill() }
        })
        col.addView(
            Ui.row(
                this,
                Ui.button(this, "Export") { export() },
                Ui.button(this, "Import") { import() },
            ),
        )
        result = Ui.text(this)
        col.addView(result)
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(list)
    }

    override fun onResume() {
        super.onResume()
        ShieldState.addListener(listener)
        show()
    }

    override fun onPause() {
        ShieldState.removeListener(listener)
        super.onPause()
    }

    /** The list and the last import result. An import that ends after a screen rotation reaches the new screen here. */
    private fun show() {
        lastResult?.let { result.text = it }
        fill()
    }

    private fun fill() {
        list.removeAllViews()
        val domains = store.allowDomains()
        if (domains.isEmpty()) list.addView(Ui.text(this, "The list is empty."))
        for (d in domains) {
            list.addView(
                Ui.button(this, "$d   (tap to remove)") {
                    AlertDialog.Builder(this).setMessage("Remove $d?").setNegativeButton("Cancel", null)
                        .setPositiveButton("Remove") { _, _ ->
                            store.setAllowDomains(store.allowDomains() - d)
                            changed()
                        }.show()
                }.apply { textAlignment = android.view.View.TEXT_ALIGNMENT_VIEW_START },
            )
        }
    }

    private fun changed() {
        ShieldState.rebuildPolicy(store)
        ShieldVpnService.command(this, ShieldVpnService.ACTION_RELOAD)
        fill()
    }

    private fun export() {
        val i = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json").putExtra(Intent.EXTRA_TITLE, "adgecko-allow-domains.json")
        @Suppress("DEPRECATION")
        startActivityForResult(i, REQ_EXPORT)
    }

    private fun import() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
        @Suppress("DEPRECATION")
        startActivityForResult(i, REQ_IMPORT)
    }

    @Deprecated("Platform API without AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        try {
            when (requestCode) {
                REQ_EXPORT -> {
                    contentResolver.openOutputStream(uri, "wt")!!.use { it.write(AllowListCodec.encode(store.allowDomains()).toByteArray()) }
                    result.text = "Exported ${store.allowDomains().size} entries."
                }
                REQ_IMPORT -> importAsync(uri)
            }
        } catch (e: Exception) {
            result.text = "Error: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    /**
     * Reads, checks and stores the import on a background thread: a slow
     * document provider must not block the screen. A refused value is cut to
     * 80 characters in the result text (review of 2026-11-17).
     */
    private fun importAsync(uri: android.net.Uri) {
        lastResult = "Importing..."
        result.text = lastResult
        val validate = AllowFlow.validator()
        Thread({
            val text = try {
                val bytes = contentResolver.openInputStream(uri)!!.use { s -> s.readNBytes(MAX_IMPORT_BYTES + 1) }
                if (bytes.size > MAX_IMPORT_BYTES) throw AllowListCodec.FormatException("file is larger than $MAX_IMPORT_BYTES bytes")
                val r = AllowListCodec.merge(store.allowDomains(), AllowListCodec.entries(String(bytes, Charsets.UTF_8)), validate)
                store.setAllowDomains(r.domains)
                buildString {
                    append("Imported ${r.added} new entries. Refused ${r.refused.size}. Over the limit ${r.overLimit}.")
                    for ((v, why) in r.refused.take(10)) append("\n - ${cut(v)}: $why")
                }
            } catch (e: Exception) {
                "Error: ${cut(e.message ?: e.javaClass.simpleName)}"
            }
            lastResult = text
            // rebuildPolicy() calls the state listeners on the main thread, so
            // the screen that is visible now (also a new one) shows the result.
            ShieldState.rebuildPolicy(store)
            ShieldVpnService.command(applicationContext, ShieldVpnService.ACTION_RELOAD)
        }, "shield-import").start()
    }

    private fun cut(s: String) = if (s.length > 80) s.take(77) + "..." else s

    companion object {
        /** The last import result, kept for the process (memory only). */
        @Volatile private var lastResult: String? = null
        private const val REQ_EXPORT = 1
        private const val REQ_IMPORT = 2
        private const val MAX_IMPORT_BYTES = 512 * 1024
    }
}
