package adgecko.shield

import adgecko.shield.store.ShieldStore
import adgecko.shield.vpn.ShieldNotification
import adgecko.shield.vpn.ShieldState
import android.app.Application

/** Process start: create the notification channel and load the bundled data in the background. */
class ShieldApp : Application() {
    lateinit var store: ShieldStore
        private set

    override fun onCreate() {
        super.onCreate()
        store = ShieldStore(this)
        ShieldNotification.createChannel(this)
        ShieldState.loadDataAsync(this)
    }
}
