package adgecko.shield.ui

import adgecko.shield.ShieldApp
import adgecko.shield.core.DohUrl
import adgecko.shield.core.Mode
import adgecko.shield.vpn.NetworkWatcher
import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.content.Intent
import android.net.ConnectivityManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.Switch
import android.widget.TextView
import java.text.DateFormat
import java.util.Date

/**
 * Main screen (docs/android/PLAN.md section 6.3): On/Off, mode, status, data
 * date and counts, the Private DNS mode, the number of blocks, the last
 * error, the Self-test, the Private DNS warning, the Always-on VPN hint, and
 * links to the other screens. The owner checks need no adb.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var onOff: Switch
    private lateinit var modeGroup: RadioGroup
    private lateinit var pauseButton: android.widget.Button
    private lateinit var info: TextView
    private lateinit var privateDns: TextView
    private lateinit var selfTest: TextView
    private lateinit var dohSaved: TextView
    private val main = Handler(Looper.getMainLooper())
    private val listener: () -> Unit = { refresh() }
    private val tick = object : Runnable {
        override fun run() {
            refresh()
            main.postDelayed(this, 2000)
        }
    }
    private var updating = false

    private val store get() = (application as ShieldApp).store

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = Ui.screen(this, "Adgecko Shield")
        status = Ui.text(this)
        col.addView(status)

        onOff = Switch(this).apply {
            text = "Shield (DNS filter for all apps)"
            setOnCheckedChangeListener { _, checked -> if (!updating) toggle(checked) }
        }
        col.addView(onOff)

        col.addView(Ui.heading(this, "Mode"))
        modeGroup = RadioGroup(this)
        val ads = RadioButton(this).apply { id = ID_ADS; text = "Ads + threat (lists and malware hosts)" }
        val threat = RadioButton(this).apply { id = ID_THREAT; text = "Threat only (malware hosts)" }
        modeGroup.addView(ads)
        modeGroup.addView(threat)
        modeGroup.setOnCheckedChangeListener { _, id ->
            if (updating) return@setOnCheckedChangeListener
            store.mode = if (id == ID_THREAT) Mode.THREAT_ONLY else Mode.ADS_AND_THREAT
            ShieldState.rebuildPolicy(store)
            ShieldVpnService.command(this, ShieldVpnService.ACTION_RELOAD)
        }
        col.addView(modeGroup)

        pauseButton = Ui.button(this, "Pause 10 min") {
            val action = if (store.isPaused()) ShieldVpnService.ACTION_RESUME else ShieldVpnService.ACTION_PAUSE
            ShieldVpnService.command(this, action)
            main.postDelayed({ refresh() }, 300)
        }
        col.addView(pauseButton)
        col.addView(Ui.text(this, "Pause stops the list layer for 10 minutes. Threat blocking stays on."))

        col.addView(Ui.heading(this, "Self-test"))
        selfTest = Ui.text(this, "Not run.")
        col.addView(Ui.button(this, "Run Self-test") { runSelfTest() })
        col.addView(selfTest)

        col.addView(Ui.heading(this, "Status"))
        info = Ui.text(this)
        col.addView(info)
        privateDns = Ui.text(this)
        col.addView(privateDns)

        col.addView(Ui.heading(this, "Upstream DNS (DoH)"))
        col.addView(
            Ui.text(
                this,
                "No URL saved: the Shield sends allowed queries to the DNS servers of your network. With a saved URL: " +
                    "the Shield sends allowed queries encrypted (DNS over HTTPS) to that URL. Blocked queries never " +
                    "leave the phone. After 3 DoH failures in a row, the Shield uses the network DNS servers for 30 " +
                    "seconds, then tries DoH again. To stop DoH, press Clear.",
            ),
        )
        col.addView(Ui.text(this, DOH_EXAMPLE))
        // The field never shows the saved URL: its path holds a private profile ID. The id
        // lets Android keep the typed text over a rotation. refresh() must not touch the text.
        val dohInput = EditText(this).apply {
            id = ID_DOH
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            // A keyboard must not learn the profile ID in the path.
            imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            hint = "https://"
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        col.addView(dohInput)
        dohSaved = Ui.text(this, savedText())
        col.addView(dohSaved)
        val dohResult = Ui.text(this)
        col.addView(
            Ui.row(
                this,
                Ui.button(this, "Save") {
                    val typed = dohInput.text.toString()
                    if (typed.isBlank()) {
                        dohResult.text = "Type a DoH URL, or press Clear to stop DoH."
                        return@button
                    }
                    val url = DohUrl.parse(typed)
                    if (url == null) {
                        dohResult.text = "Not a valid https URL."
                    } else {
                        applyDoh(url)
                        dohInput.setText("")
                        dohResult.text = "Saved. Allowed queries go to ${url.host} over DoH."
                    }
                },
                Ui.button(this, "Clear") {
                    applyDoh(null)
                    dohInput.setText("")
                    dohResult.text = "Cleared. Allowed queries go to the network DNS servers."
                },
            ),
        )
        col.addView(dohResult)

        col.addView(Ui.heading(this, "Always-on VPN"))
        col.addView(
            Ui.text(
                this,
                "You can set Adgecko Shield as Always-on VPN in the Android VPN settings. Do not turn on " +
                    "\"Block connections without VPN\": the Shield routes only DNS, so that setting can stop other traffic.",
            ),
        )
        col.addView(Ui.button(this, "Open VPN settings") { startActivity(Intent(Settings.ACTION_VPN_SETTINGS)) })

        col.addView(Ui.heading(this, "More"))
        col.addView(Ui.button(this, "Recent blocks") { startActivity(Intent(this, RecentBlocksActivity::class.java)) })
        col.addView(Ui.button(this, "Allow list") { startActivity(Intent(this, AllowListActivity::class.java)) })
        col.addView(Ui.button(this, "Exclude apps") { startActivity(Intent(this, AppExclusionsActivity::class.java)) })
        col.addView(Ui.button(this, "About and licences") { startActivity(Intent(this, AboutActivity::class.java)) })
    }

    override fun onResume() {
        super.onResume()
        ShieldState.addListener(listener)
        main.post(tick)
    }

    override fun onPause() {
        ShieldState.removeListener(listener)
        main.removeCallbacks(tick)
        super.onPause()
    }

    /**
     * Stores the DoH URL (null clears it) and tells a running shield to build
     * its upstream again. The new Upstream has its own counts.
     */
    private fun applyDoh(url: DohUrl?) {
        store.dohUrl = url
        dohSaved.text = savedText()
        ShieldVpnService.command(this, ShieldVpnService.ACTION_REBUILD)
    }

    /** What is saved. It names the host only, never the URL. */
    private fun savedText(): String {
        val host = store.dohUrl?.host
        return if (host != null) "Saved: DoH to $host." else "Saved: none (network DNS)."
    }

    private fun toggle(on: Boolean) {
        if (on) {
            startActivity(Intent(this, ConsentActivity::class.java))
        } else {
            ShieldVpnService.command(this, ShieldVpnService.ACTION_STOP)
            store.wantOn = false
        }
    }

    private fun runSelfTest() {
        selfTest.text = "Running..."
        Thread({
            val r = try {
                SelfTest.run()
            } catch (e: Exception) {
                "Self-test error: ${e.javaClass.simpleName}"
            }
            main.post { selfTest.text = r }
        }, "shield-selftest").start()
    }

    private fun refresh() {
        updating = true
        val s = ShieldState.status
        val paused = store.isPaused()
        status.text = when (s) {
            ShieldState.Status.ON -> "On: protecting all apps."
            ShieldState.Status.PAUSED -> "Paused until " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(store.pausedUntil)) + ". Threat blocking stays on."
            ShieldState.Status.STARTING -> "Starting..."
            ShieldState.Status.OFF -> "Off."
            ShieldState.Status.ERROR -> "Off. Error: " + (ShieldState.lastError ?: "unknown")
        }
        onOff.isChecked = s == ShieldState.Status.ON || s == ShieldState.Status.PAUSED || s == ShieldState.Status.STARTING
        modeGroup.check(if (store.mode == Mode.THREAT_ONLY) ID_THREAT else ID_ADS)
        pauseButton.text = if (paused) "Resume now" else "Pause 10 min"

        val d = ShieldState.data
        val dataLine = when {
            d != null -> "Data: lists packed ${d.packedAtUtc} (UTC), ${"%,d".format(d.listCount)} list hosts, ${"%,d".format(d.threatCount)} threat names."
            ShieldState.dataError != null -> "Data error: ${ShieldState.dataError}. The shield forwards all queries except the Self-test name (fail-open)."
            else -> "Data: loading..."
        }
        info.text = buildString {
            append(dataLine).append('\n')
            append("Blocks today: ${ShieldState.blocksToday()}. Queries: ${ShieldState.queries.get()}.\n")
            val addresses = "Shield addresses: ${ShieldState.aliasText.ifEmpty { "none" }}."
            // Host and counts come from the same DohStats, so they never mix two URLs. Without
            // running stats the store gives the host (Shield off, or the rebuild after Save or Clear).
            val stats = ShieldState.dohStats
            val dohHost = store.dohUrl?.host
            if (stats != null) {
                append("Upstream: DoH ${stats.host}: ${stats.answers.get()} via DoH, ${stats.plain.get()} via network DNS")
                stats.lastReason?.let { append(", last reason ").append(it) }
                stats.lastFailure?.let { append(", last DoH failure ").append(it) }
                append("\n")
            } else if (dohHost != null) {
                append("Upstream: DoH $dohHost: 0 via DoH, 0 via network DNS\n")
            } else {
                append("Upstream: network DNS servers\n")
            }
            append("Network DNS servers: ${ShieldState.upstreamCount}. $addresses\n")
            append("Errors: policy ${ShieldState.policyErrors}, upstream ${ShieldState.forwardErrors.get()}.\n")
            append("Allow list: ${store.allowDomains().size} entries. Excluded apps: ${store.excludedApps().size}.")
            ShieldState.lastError?.let { append("\nLast error: ").append(it) }
        }
        privateDns.text = privateDnsText()
        updating = false
    }

    private fun privateDnsText(): String {
        val mode = runCatching { Settings.Global.getString(contentResolver, "private_dns_mode") }.getOrNull()
        val shown = when (mode) {
            null -> "automatic (default)"
            "opportunistic" -> "automatic"
            "off" -> "off"
            "hostname" -> "hostname"
            else -> mode
        }
        val cm = getSystemService(ConnectivityManager::class.java)
        val net = NetworkWatcher.bestNow(cm)
        val lp = net?.let { cm.getLinkProperties(it) }
        val serverName = lp?.privateDnsServerName
        val sb = StringBuilder("Private DNS: $shown")
        if (lp?.isPrivateDnsActive == true) sb.append(" (active)")
        if (mode == "hostname" || serverName != null) {
            sb.append("\nWarning: Private DNS uses a hostname. Apps send DNS past the Shield. Set Private DNS to Automatic or Off. " +
                    "To use NextDNS or another DoH provider with the Shield, type its DoH URL under Upstream DNS (DoH).")
        }
        return sb.toString()
    }

    companion object {
        private const val ID_ADS = 101
        private const val ID_THREAT = 102
        private const val ID_DOH = 103
        private const val DOH_EXAMPLE = "Example (NextDNS): https://dns.nextdns.io/<profile ID>"
    }
}
