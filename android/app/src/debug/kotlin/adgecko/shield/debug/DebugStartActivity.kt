package adgecko.shield.debug

import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log

/**
 * Debug variant only (src/debug). The CI emulator starts the shield with
 *   am start -n adgecko.shield/.debug.DebugStartActivity
 * normally after it gave the VPN consent with appops. Without consent, this
 * activity opens the system VPN dialog (the probe test presses OK with UI
 * Automator) and starts the shield on RESULT_OK. The shell can start this
 * activity because it is exported; ConsentActivity is not. A release build
 * has no such component.
 */
class DebugStartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        val consent = VpnService.prepare(this)
        if (consent == null) {
            Log.i(ShieldState.TAG, "debug start: consent present, starting the shield")
            ShieldVpnService.start(this)
            finish()
        } else {
            Log.w(ShieldState.TAG, "debug start: no VPN consent, opening the VPN dialog")
            @Suppress("DEPRECATION")
            startActivityForResult(consent, REQ_VPN)
        }
    }

    @Deprecated("Platform API without AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_VPN && resultCode == RESULT_OK) {
            Log.i(ShieldState.TAG, "debug start: consent given in the dialog, starting the shield")
            ShieldVpnService.start(this)
        } else {
            Log.w(ShieldState.TAG, "debug start: the VPN dialog was refused")
        }
        finish()
    }

    companion object {
        private const val REQ_VPN = 1
    }
}
