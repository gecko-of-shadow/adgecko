package adgecko.shield.vpn

import adgecko.shield.BuildConfig
import adgecko.shield.ShieldApp
import adgecko.shield.core.Action
import adgecko.shield.core.Outcome
import adgecko.shield.core.PacketHandler
import adgecko.shield.core.RecentBlocks
import adgecko.shield.store.ShieldStore
import adgecko.shield.ui.MainActivity
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * The DNS shield (docs/android/PLAN.md section 6.6). A local DNS-only VPN:
 * only fake DNS addresses in a TEST-NET range go into the interface. All
 * other traffic uses the real network as before.
 *
 * - No allowBypass(): apps cannot leave the filter by binding to another
 *   network. An app that needs this can be excluded.
 * - The own package is not excluded in M1, so the Self-test uses the normal
 *   DNS path. The upstream sockets use protect().
 * - establish() first, then startForeground() with type systemExempted
 *   (order not checked on a phone). If Android refuses the type, the
 *   service stops and shows a notice. No fallback type in M1.
 *
 * All phone behaviour is UNVERIFIED until a run on the owner's phone.
 */
class ShieldVpnService : VpnService() {
    private lateinit var store: ShieldStore
    private val main = Handler(Looper.getMainLooper())
    private var watcher: NetworkWatcher? = null
    @Volatile private var tun: ParcelFileDescriptor? = null
    @Volatile private var upstream: Upstream? = null
    @Volatile private var handler: PacketHandler? = null
    private var reader: Thread? = null
    private var output: FileOutputStream? = null
    private val writeLock = Any()
    private var running = false
    @Volatile private var lastNotify = 0L

    override fun onCreate() {
        super.onCreate()
        store = (application as ShieldApp).store
        // A data load that ends after the start builds the policy at once.
        ShieldState.onDataLoaded = { main.post { if (running) reloadPolicy() } }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                store.wantOn = false
                stopShield(null)
                return START_NOT_STICKY
            }
            ACTION_PAUSE, ACTION_RESUME, ACTION_RELOAD, ACTION_REBUILD -> {
                // A command for a stopped shield must not leave a started, sticky
                // service: a later sticky restart would turn the VPN on again.
                if (!running) {
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                when (intent.action) {
                    ACTION_PAUSE -> setPause(System.currentTimeMillis() + PAUSE_MS)
                    ACTION_RESUME -> setPause(0L)
                    ACTION_RELOAD -> reloadPolicy()
                    else -> rebuildDebounced()
                }
                return START_STICKY
            }
            null -> {
                // A sticky restart after the process was killed: start only if the
                // user wants the shield on.
                if (!store.wantOn) {
                    stopSelf(startId)
                    return START_NOT_STICKY
                }
                if (!running) startShield()
                return START_STICKY
            }
            // ACTION_START and the always-on start (action android.net.VpnService).
            else -> {
                store.wantOn = true
                if (!running) startShield() else reloadPolicy()
                return START_STICKY
            }
        }
    }

    /**
     * startForeground() comes first: a start through startForegroundService()
     * must reach it on each path, also when establish() fails afterwards (else
     * Android stops the app). The systemExempted check reads only the VPN
     * consent app op (AOSP ForegroundServiceTypePolicy: anyOf includes
     * OP_ACTIVATE_VPN), not the VPN state, so the order is safe. The data is
     * not awaited: the policy is null (fail-open) until the background load
     * ends, then ShieldState.onDataLoaded() builds it.
     */
    private fun startShield() {
        ShieldState.setStatus(ShieldState.Status.STARTING)
        ShieldState.rebuildPolicy(store)
        try {
            val n = ShieldNotification.build(this, store.pausedUntil)
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(ShieldNotification.ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
            } else {
                // Android 13 has no systemExempted type check; the manifest type applies.
                startForeground(ShieldNotification.ID, n)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground refused: ${e.javaClass.simpleName}")
            val msg = "Android refused the foreground service type systemExempted (${e.javaClass.simpleName}). The shield is off."
            ShieldState.setStatus(ShieldState.Status.ERROR, msg)
            ShieldNotification.notice(this, msg)
            stopSelf()
            return
        }
        val w = NetworkWatcher(this) { main.post { if (running) rebuildDebounced() } }
        w.start()
        watcher = w
        val pfd = establishInterface()
        if (pfd == null) {
            w.stop()
            watcher = null
            ShieldState.policy.set(null)
            ShieldState.setStatus(ShieldState.Status.ERROR, "Android did not give the VPN interface (no VPN permission, or another VPN is always on).")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        running = true
        startReader(pfd)
        schedulePauseEnd()
        ShieldState.setStatus(if (store.isPaused()) ShieldState.Status.PAUSED else ShieldState.Status.ON)
    }

    /** Builds the interface. Returns null when Android gives no interface. */
    private fun establishInterface(): ParcelFileDescriptor? {
        val w = watcher
        val cm = getSystemService(ConnectivityManager::class.java)
        val servers = w?.dnsServers.orEmpty()
        val network = w?.network
        val v4servers = servers.filterIsInstance<Inet4Address>()
        val v6servers = servers.filterIsInstance<Inet6Address>()
        val base = freeTestNet(cm)
        val builder = Builder()
            .setSession("Adgecko Shield")
            .setBlocking(true)
            .setMetered(false)
            .addAddress("$base.1", 24)
            .allowFamily(OsConstants.AF_INET)
            .allowFamily(OsConstants.AF_INET6)
        val aliases = ArrayList<ByteArray>()
        val ordered = ArrayList<InetAddress>()
        // One alias for each real server, same family. With no network, one
        // IPv4 alias with no server: its queries get SERVFAIL until a network
        // comes (then the interface is built again).
        val v4 = if (v4servers.isEmpty() && v6servers.isEmpty()) listOf<InetAddress?>(null) else v4servers
        for ((i, s) in v4.withIndex()) {
            if (i >= 200) break
            val alias = InetAddress.getByName("$base.${i + 2}")
            builder.addDnsServer(alias)
            builder.addRoute(alias, 32)
            aliases += alias.address
            if (s != null) ordered += s
        }
        if (v6servers.isNotEmpty()) {
            builder.addAddress(InetAddress.getByName("2001:db8::1"), 120)
            for ((i, s) in v6servers.withIndex()) {
                if (i >= 200) break
                val alias = InetAddress.getByName("2001:db8::" + Integer.toHexString(i + 2))
                builder.addDnsServer(alias)
                builder.addRoute(alias, 128)
                aliases += alias.address
                ordered += s
            }
        }
        if (network != null) builder.setUnderlyingNetworks(arrayOf(network))
        builder.setConfigureIntent(
            PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE),
        )
        for (pkg in store.excludedApps()) {
            if (pkg == packageName) continue
            try {
                builder.addDisallowedApplication(pkg)
            } catch (e: PackageManager.NameNotFoundException) {
                // The app was removed: ignore the entry.
            }
        }
        val pfd = try {
            builder.establish()
        } catch (e: Exception) {
            Log.e(TAG, "establish failed: ${e.javaClass.simpleName}")
            null
        } ?: return null
        upstream?.close()
        upstream = Upstream(this, network, ordered)
        ShieldState.upstreamCount = ordered.size
        ShieldState.aliasText = aliases.joinToString(", ") { InetAddress.getByAddress(it).hostAddress ?: "?" }
        handler = PacketHandler(aliases, { ShieldState.policy.get() }, { ShieldState.data?.serial ?: 1L }) { q, d ->
            ShieldState.queries.incrementAndGet()
            if (d.action == Action.BLOCK) {
                ShieldState.countBlock()
                val host = q.name ?: "?"
                ShieldState.recent.add(RecentBlocks.Entry(System.currentTimeMillis(), host, d.layer, q.qtype))
                // Debug builds only: a release build writes no host names to logcat.
                if (BuildConfig.DEBUG) Log.i(TAG, "decision=block layer=${d.layer} qtype=${q.qtype} host=$host")
                notifyThrottled()
            }
        }
        return pfd
    }

    private fun startReader(pfd: ParcelFileDescriptor) {
        val old = tun
        tun = pfd
        synchronized(writeLock) { output = FileOutputStream(pfd.fileDescriptor) }
        val t = Thread({ readLoop(pfd) }, "shield-reader")
        reader = t
        t.start()
        if (old != null) closeQuietly(old)
    }

    private fun readLoop(pfd: ParcelFileDescriptor) {
        val input = FileInputStream(pfd.fileDescriptor)
        val buf = ByteArray(32767)
        while (tun === pfd) {
            val n = try {
                input.read(buf)
            } catch (e: IOException) {
                break
            }
            if (n <= 0) {
                if (n < 0) break
                continue
            }
            val h = handler ?: continue
            when (val out = h.handle(buf, n)) {
                is Outcome.Reply -> write(out.bytes)
                is Outcome.Forward -> {
                    val up = upstream
                    if (up == null) {
                        h.servfailReply(out.ret, out.query)?.let { write(it) }
                    } else {
                        up.send(out.upstreamIndex, out.query) { answer ->
                            if (answer != null) {
                                write(h.forwardReply(out.ret, answer))
                            } else {
                                ShieldState.forwardErrors.incrementAndGet()
                                h.servfailReply(out.ret, out.query)?.let { write(it) }
                            }
                        }
                    }
                }
                Outcome.Drop -> Unit
            }
            ShieldState.policyErrors = h.errors
        }
    }

    /**
     * Writes to the current interface. An answer that a query on an older
     * interface started still reaches its client after a rebuild: the
     * interface address and the alias stay the same while the TEST-NET range
     * does not change.
     */
    private fun write(bytes: ByteArray) {
        synchronized(writeLock) {
            try {
                output?.write(bytes)
            } catch (e: IOException) {
                // The interface was closed or rebuilt.
            }
        }
    }

    private val rebuildNow = Runnable { if (running) rebuild() }

    /** A network handover gives onLost and onAvailable close together: build one time. */
    private fun rebuildDebounced() {
        main.removeCallbacks(rebuildNow)
        main.postDelayed(rebuildNow, 500)
    }

    /** Network or exclusion change: build a new interface, then close the old one. */
    private fun rebuild() {
        val pfd = establishInterface()
        if (pfd == null) {
            stopShield("Android did not give a new VPN interface.")
            return
        }
        startReader(pfd)
        ShieldState.changed()
    }

    private fun reloadPolicy() {
        ShieldState.rebuildPolicy(store)
        ShieldState.setStatus(if (store.isPaused()) ShieldState.Status.PAUSED else ShieldState.Status.ON)
        updateNotification()
    }

    private fun setPause(until: Long) {
        store.pausedUntil = until
        reloadPolicy()
        schedulePauseEnd()
    }

    private val pauseEnd = Runnable {
        if (running && store.pausedUntil != 0L && !store.isPaused()) setPause(0L)
    }

    private fun schedulePauseEnd() {
        main.removeCallbacks(pauseEnd)
        val left = store.pausedUntil - System.currentTimeMillis()
        if (left > 0) main.postDelayed(pauseEnd, left + 500) else if (store.pausedUntil != 0L) store.pausedUntil = 0L
    }

    private fun notifyThrottled() {
        val now = System.currentTimeMillis()
        if (now - lastNotify < 5000) return
        lastNotify = now
        main.post { updateNotification() }
    }

    private fun updateNotification() {
        if (!running) return
        val nm = getSystemService(NotificationManager::class.java)
        runCatching { nm.notify(ShieldNotification.ID, ShieldNotification.build(this, store.pausedUntil)) }
    }

    private fun stopShield(error: String?) {
        running = false
        main.removeCallbacks(pauseEnd)
        main.removeCallbacks(rebuildNow)
        watcher?.stop()
        watcher = null
        val old = tun
        tun = null
        synchronized(writeLock) { output = null }
        if (old != null) closeQuietly(old)
        upstream?.close()
        upstream = null
        handler = null
        ShieldState.policy.set(null)
        ShieldState.setStatus(if (error == null) ShieldState.Status.OFF else ShieldState.Status.ERROR, error)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() {
        // Another VPN took the slot, or the user removed the permission.
        store.wantOn = false
        stopShield("Android stopped the shield (another VPN, or the VPN permission was removed).")
    }

    override fun onDestroy() {
        ShieldState.onDataLoaded = null
        if (running) stopShield(null)
        super.onDestroy()
    }

    private fun closeQuietly(pfd: ParcelFileDescriptor) {
        try {
            pfd.close()
        } catch (e: IOException) {
            // ignore
        }
    }

    companion object {
        const val TAG = ShieldState.TAG
        const val ACTION_START = "adgecko.shield.action.START"
        const val ACTION_STOP = "adgecko.shield.action.STOP"
        const val ACTION_PAUSE = "adgecko.shield.action.PAUSE"
        const val ACTION_RESUME = "adgecko.shield.action.RESUME"
        const val ACTION_RELOAD = "adgecko.shield.action.RELOAD"
        const val ACTION_REBUILD = "adgecko.shield.action.REBUILD"
        const val PAUSE_MS = 10 * 60 * 1000L
        private val TEST_NETS = listOf("192.0.2", "198.51.100", "203.0.113")

        /** The first TEST-NET /24 that no network of the phone uses. */
        fun freeTestNet(cm: ConnectivityManager): String {
            val used = HashSet<String>()
            @Suppress("DEPRECATION")
            for (n in cm.allNetworks) {
                // Skip VPN networks: the own interface must not move to a new range on a rebuild.
                val caps = cm.getNetworkCapabilities(n)
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
                val lp = cm.getLinkProperties(n) ?: continue
                for (la in lp.linkAddresses) {
                    val a = la.address
                    if (a is Inet4Address) {
                        val b = a.address
                        used += "${b[0].toInt() and 0xff}.${b[1].toInt() and 0xff}.${b[2].toInt() and 0xff}"
                    }
                }
            }
            return TEST_NETS.firstOrNull { it !in used } ?: TEST_NETS[0]
        }

        /** Starts the shield. The caller checks VpnService.prepare() first. */
        fun start(context: Context) {
            context.startForegroundService(Intent(context, ShieldVpnService::class.java).setAction(ACTION_START))
        }

        /** Sends a command to a running shield. Does nothing when the shield is off. */
        fun command(context: Context, action: String) {
            if (ShieldState.status == ShieldState.Status.OFF || ShieldState.status == ShieldState.Status.ERROR) {
                if (action == ACTION_PAUSE || action == ACTION_RESUME) {
                    val store = (context.applicationContext as ShieldApp).store
                    store.pausedUntil = if (action == ACTION_PAUSE) System.currentTimeMillis() + PAUSE_MS else 0L
                    ShieldState.rebuildPolicy(store)
                }
                return
            }
            context.startService(Intent(context, ShieldVpnService::class.java).setAction(action))
        }
    }
}
