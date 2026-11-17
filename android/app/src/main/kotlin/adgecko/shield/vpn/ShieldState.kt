package adgecko.shield.vpn

import adgecko.shield.BuildConfig
import adgecko.shield.core.DnsPolicy
import adgecko.shield.core.RecentBlocks
import adgecko.shield.core.ShieldData
import adgecko.shield.store.ShieldStore
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Process-wide state of the Shield (docs/android/PLAN.md section 6.3):
 * On, Paused (with end time) or Off; the counts; the recent blocks (memory
 * only); the current DnsPolicy. The screens, the tile and the notification
 * read it. A change calls the listeners on the main thread.
 */
object ShieldState {
    const val TAG = "AdgeckoShield"

    enum class Status { OFF, STARTING, ON, PAUSED, ERROR }

    @Volatile var status: Status = Status.OFF
        private set
    @Volatile var lastError: String? = null
        private set
    @Volatile var data: ShieldData? = null
        private set
    @Volatile var dataError: String? = null
        private set
    @Volatile var upstreamCount: Int = 0
    @Volatile var aliasText: String = ""

    val policy = AtomicReference<DnsPolicy?>(null)
    val recent = RecentBlocks(200)
    val queries = AtomicLong()
    val forwardErrors = AtomicLong()
    private val blocksToday = AtomicLong()
    @Volatile private var blocksDay = 0L
    @Volatile var policyErrors: Long = 0

    private val loaded = CountDownLatch(1)
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    fun loadDataAsync(context: Context) {
        val app = context.applicationContext
        Thread({
            try {
                val t0 = System.nanoTime()
                data = ShieldData.load { path -> app.assets.open("shield/$path").use { it.readBytes() } }
                if (BuildConfig.DEBUG) Log.i(TAG, "data loaded in ${(System.nanoTime() - t0) / 1_000_000} ms")
            } catch (e: Exception) {
                dataError = e.message ?: e.javaClass.simpleName
                Log.e(TAG, "data load failed: $dataError")
            } finally {
                loaded.countDown()
                changed()
            }
        }, "shield-data").start()
    }

    /** Waits for the data load, at most [ms] milliseconds. */
    fun awaitData(ms: Long): ShieldData? {
        loaded.await(ms, TimeUnit.MILLISECONDS)
        return data
    }

    /** A new policy object from the data and the stored settings. Null while the data is missing (fail-open). */
    fun rebuildPolicy(store: ShieldStore) {
        val d = data
        policy.set(if (d == null) null else DnsPolicy(d.policyData, store.mode, store.isPaused(), store.allowDomains()))
        changed()
    }

    fun setStatus(s: Status, error: String? = null) {
        status = s
        lastError = error
        changed()
    }

    fun countBlock() {
        val day = System.currentTimeMillis() / 86_400_000L
        if (day != blocksDay) {
            blocksDay = day
            blocksToday.set(0)
        }
        blocksToday.incrementAndGet()
    }

    fun blocksToday(): Long = if (System.currentTimeMillis() / 86_400_000L == blocksDay) blocksToday.get() else 0

    fun addListener(l: () -> Unit) = listeners.add(l)

    fun removeListener(l: () -> Unit) = listeners.remove(l)

    fun changed() {
        main.post { for (l in listeners) l() }
    }
}
