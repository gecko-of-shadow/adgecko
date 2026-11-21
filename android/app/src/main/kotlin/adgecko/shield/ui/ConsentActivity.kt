package adgecko.shield.ui

import adgecko.shield.ShieldApp
import adgecko.shield.vpn.ShieldVpnService
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Bundle
import android.widget.Toast

/**
 * Asks for the VPN consent (VpnService.prepare()) and starts the shield after
 * consent. It asks for POST_NOTIFICATIONS one time; the shield works without
 * it. No screen of its own (translucent).
 */
class ConsentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        val consent = VpnService.prepare(this)
        if (consent == null) {
            afterConsent()
        } else {
            @Suppress("DEPRECATION")
            startActivityForResult(consent, REQ_VPN)
        }
    }

    @Deprecated("Platform API without AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_VPN) return
        if (resultCode == RESULT_OK) {
            afterConsent()
        } else {
            Toast.makeText(this, "The VPN permission was refused. The shield stays off.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun afterConsent() {
        val store = (application as ShieldApp).store
        store.pausedUntil = 0L
        ShieldVpnService.start(this)
        if (!store.askedNotifications && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            store.askedNotifications = true
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        } else {
            finish()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        finish()
    }

    companion object {
        private const val REQ_VPN = 1
        private const val REQ_NOTIFY = 2
    }
}
