package adgecko.shield.debug

import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.Activity
import android.net.VpnService
import android.os.Bundle
import android.util.Log

/**
 * Debug variant only (src/debug). The CI emulator starts the shield with
 *   am start -n adgecko.shield/.debug.DebugStartActivity
 * after it gave the VPN consent with appops. It starts the shield only if the
 * consent exists, then finishes. A release build has no such component.
 */
class DebugStartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (VpnService.prepare(this) == null) {
            Log.i(ShieldState.TAG, "debug start: consent present, starting the shield")
            ShieldVpnService.start(this)
        } else {
            Log.w(ShieldState.TAG, "debug start: no VPN consent, the shield stays off")
        }
        finish()
    }
}
