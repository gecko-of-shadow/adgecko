package adgecko.shield.store

import adgecko.shield.core.Mode
import android.content.Context
import java.io.File

/**
 * Settings of the Shield (docs/android/PLAN.md sections 6.3 and 8).
 * Switches in SharedPreferences. The allow list and the excluded apps in
 * noBackupFilesDir. allowBackup is false and the data extraction rules
 * exclude all data. Recent blocks are not stored (memory only, OD-12).
 */
class ShieldStore(context: Context) {
    private val prefs = context.getSharedPreferences("shield", Context.MODE_PRIVATE)
    private val dir: File = context.noBackupFilesDir
    private val allowFile = File(dir, "allow-domains.json")
    private val appsFile = File(dir, "excluded-apps.json")

    /** Default "Ads + threat" (owner default OD-8). */
    var mode: Mode
        get() = runCatching { Mode.of(prefs.getString(KEY_MODE, Mode.ADS_AND_THREAT.id)!!) }.getOrDefault(Mode.ADS_AND_THREAT)
        set(v) = prefs.edit().putString(KEY_MODE, v.id).apply()

    /** The user wants the shield on (the tile and the switch). */
    var wantOn: Boolean
        get() = prefs.getBoolean(KEY_ON, false)
        set(v) = prefs.edit().putBoolean(KEY_ON, v).apply()

    /** End of "Pause 10 min" (epoch ms); 0 = not paused. Stored, so a restart keeps it. */
    var pausedUntil: Long
        get() = prefs.getLong(KEY_PAUSE, 0L)
        set(v) = prefs.edit().putLong(KEY_PAUSE, v).apply()

    var askedNotifications: Boolean
        get() = prefs.getBoolean(KEY_ASKED_NOTIFY, false)
        set(v) = prefs.edit().putBoolean(KEY_ASKED_NOTIFY, v).apply()

    fun isPaused(now: Long = System.currentTimeMillis()): Boolean = pausedUntil > now

    @Synchronized
    fun allowDomains(): List<String> {
        if (!allowFile.isFile) return emptyList()
        return runCatching { AllowListCodec.entries(allowFile.readText()).filterIsInstance<String>() }.getOrDefault(emptyList())
    }

    @Synchronized
    fun setAllowDomains(domains: List<String>) = writeAtomic(allowFile, AllowListCodec.encode(domains.take(AllowListCodec.MAX_ENTRIES)))

    @Synchronized
    fun excludedApps(): Set<String> = if (appsFile.isFile) AllowListCodec.decodeApps(appsFile.readText()) else emptySet()

    @Synchronized
    fun setExcludedApps(apps: Set<String>) = writeAtomic(appsFile, AllowListCodec.encodeApps(apps))

    private fun writeAtomic(f: File, text: String) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) {
            f.writeText(text)
            tmp.delete()
        }
    }

    companion object {
        private const val KEY_MODE = "mode"
        private const val KEY_ON = "on"
        private const val KEY_PAUSE = "pausedUntil"
        private const val KEY_ASKED_NOTIFY = "askedNotifications"
    }
}
