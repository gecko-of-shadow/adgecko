package adgecko.shield.vpn

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import java.net.InetAddress

/**
 * Follows the best network with INTERNET and NOT_VPN (docs/android/PLAN.md
 * section 6.3). A change of the network or of its DNS servers calls
 * [onChange], and the service builds the interface again.
 */
class NetworkWatcher(context: Context, private val onChange: () -> Unit) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    @Volatile var network: Network? = null
        private set
    @Volatile var dnsServers: List<InetAddress> = emptyList()
        private set
    @Volatile var privateDnsActive: Boolean = false
        private set
    @Volatile var privateDnsServerName: String? = null
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) {
            update(n, cm.getLinkProperties(n))
        }

        override fun onLinkPropertiesChanged(n: Network, lp: LinkProperties) {
            update(n, lp)
        }

        override fun onLost(n: Network) {
            if (n == network) {
                network = null
                dnsServers = emptyList()
                onChange()
            }
        }
    }

    private fun update(n: Network, lp: LinkProperties?) {
        val servers = lp?.dnsServers.orEmpty()
        privateDnsActive = lp?.isPrivateDnsActive == true
        privateDnsServerName = lp?.privateDnsServerName
        if (n != network || servers != dnsServers) {
            network = n
            dnsServers = servers
            onChange()
        }
    }

    fun start() {
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()
        // Fill the first values at once, so the service can build the interface now.
        val now = bestNow(cm)
        if (now != null) {
            network = now
            val lp = cm.getLinkProperties(now)
            dnsServers = lp?.dnsServers.orEmpty()
            privateDnsActive = lp?.isPrivateDnsActive == true
            privateDnsServerName = lp?.privateDnsServerName
        }
        cm.registerBestMatchingNetworkCallback(req, callback, Handler(Looper.getMainLooper()))
    }

    fun stop() {
        runCatching { cm.unregisterNetworkCallback(callback) }
    }

    companion object {
        /** The active network if it is not a VPN, else the first non-VPN network with INTERNET. */
        fun bestNow(cm: ConnectivityManager): Network? {
            val active = cm.activeNetwork
            val caps = active?.let { cm.getNetworkCapabilities(it) }
            if (caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            ) return active
            @Suppress("DEPRECATION")
            return cm.allNetworks.firstOrNull { n ->
                val c = cm.getNetworkCapabilities(n)
                c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
        }
    }
}
