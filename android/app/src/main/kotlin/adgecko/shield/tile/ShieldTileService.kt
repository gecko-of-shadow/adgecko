package adgecko.shield.tile

import adgecko.shield.ShieldApp
import adgecko.shield.ui.ConsentActivity
import adgecko.shield.vpn.ShieldState
import adgecko.shield.vpn.ShieldVpnService
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * Quick Settings tile (docs/android/PLAN.md section 6.3). A tap moves
 * On -> Paused (10 min, list layer only; threat stays on) -> Off -> On.
 * When the VPN consent is missing, the tile opens ConsentActivity. A long
 * press opens MainActivity (QS_TILE_PREFERENCES). UNVERIFIED on a phone.
 *
 * Lock screen (review of 2026-11-17): Pause and Off ask for the unlock
 * first (unlockAndRun), so a person who holds the locked phone cannot turn
 * the protection off. On needs no unlock: it only adds protection.
 */
class ShieldTileService : TileService() {
    private val listener: () -> Unit = { refresh() }

    override fun onStartListening() {
        super.onStartListening()
        ShieldState.addListener(listener)
        refresh()
    }

    override fun onStopListening() {
        ShieldState.removeListener(listener)
        super.onStopListening()
    }

    override fun onClick() {
        super.onClick()
        when (ShieldState.status) {
            ShieldState.Status.ON -> whenUnlocked { ShieldVpnService.command(this, ShieldVpnService.ACTION_PAUSE) }
            ShieldState.Status.PAUSED -> whenUnlocked { ShieldVpnService.command(this, ShieldVpnService.ACTION_STOP) }
            ShieldState.Status.STARTING -> Unit
            ShieldState.Status.OFF, ShieldState.Status.ERROR -> start()
        }
        refresh()
    }

    private fun whenUnlocked(action: () -> Unit) {
        if (isSecure && isLocked) {
            unlockAndRun { action(); refresh() }
        } else {
            action()
        }
    }

    private fun start() {
        val consent = VpnService.prepare(this)
        if (consent != null) {
            openConsent()
            return
        }
        try {
            (application as ShieldApp).store.pausedUntil = 0L
            ShieldVpnService.start(this)
        } catch (e: Exception) {
            // Android can refuse a service start from the background: open the consent screen, which starts it.
            openConsent()
        }
    }

    private fun openConsent() {
        val intent = Intent(this, ConsentActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(intent)
        }
    }

    private fun refresh() {
        val tile = qsTile ?: return
        when (ShieldState.status) {
            ShieldState.Status.ON -> {
                tile.state = Tile.STATE_ACTIVE
                tile.subtitle = "On"
            }
            ShieldState.Status.PAUSED -> {
                tile.state = Tile.STATE_ACTIVE
                tile.subtitle = "Paused"
            }
            ShieldState.Status.STARTING -> {
                tile.state = Tile.STATE_ACTIVE
                tile.subtitle = "Starting"
            }
            ShieldState.Status.OFF, ShieldState.Status.ERROR -> {
                tile.state = Tile.STATE_INACTIVE
                tile.subtitle = "Off"
            }
        }
        tile.updateTile()
    }
}
