package adgecko.shield.vpn

import adgecko.shield.R
import adgecko.shield.ui.MainActivity
import adgecko.shield.ui.RecentBlocksActivity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.text.DateFormat
import java.util.Date

/**
 * The status notification (docs/android/PLAN.md section 6.3): channel
 * "shield", low importance, ongoing. Text "Protecting all apps" and the
 * number of blocks today (memory only). Actions "Pause 10 min" (or
 * "Resume") and "Recent blocks". Without POST_NOTIFICATIONS the shield works,
 * but Android does not show this notification.
 */
object ShieldNotification {
    const val CHANNEL = "shield"
    const val ID = 1
    const val NOTICE_ID = 2

    fun createChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val ch = NotificationChannel(CHANNEL, "Shield status", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Shows that Adgecko Shield filters DNS for all apps."
        ch.setShowBadge(false)
        nm.createNotificationChannel(ch)
    }

    fun build(context: Context, pausedUntil: Long): Notification {
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val recent = PendingIntent.getActivity(
            context, 1, Intent(context, RecentBlocksActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val paused = pausedUntil > System.currentTimeMillis()
        val action = if (paused) ShieldVpnService.ACTION_RESUME else ShieldVpnService.ACTION_PAUSE
        val pause = PendingIntent.getService(
            context, 2, Intent(context, ShieldVpnService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val blocks = ShieldState.blocksToday()
        val title = if (paused) {
            "Paused until " + DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(pausedUntil)) + ". Threat blocking stays on."
        } else {
            "Protecting all apps"
        }
        return Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(title)
            .setContentText("$blocks blocks today")
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(Notification.Action.Builder(null, if (paused) "Resume" else "Pause 10 min", pause).build())
            .addAction(Notification.Action.Builder(null, "Recent blocks", recent).build())
            .build()
    }

    /** A notice that is not a foreground notification (for example: Android refused the service type). */
    fun notice(context: Context, text: String) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val open = PendingIntent.getActivity(
            context, 3, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle("Adgecko Shield stopped")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTICE_ID, n) }
    }
}
