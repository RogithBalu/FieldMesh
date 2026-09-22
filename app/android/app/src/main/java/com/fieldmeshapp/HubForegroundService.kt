package com.fieldmeshapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps the local sync hub alive while the app is not in the foreground.
 *
 * Android stops most background work within minutes, which would silently kill
 * the hub's TCP server mid-inspection — the phone acting as hub would still
 * show a hotspot while no longer syncing anyone. A foreground service with a
 * visible notification is the only supported way to hold a listening socket
 * open, and the notification doubles as the signal to the inspector that their
 * phone is the hub.
 */
class HubForegroundService : Service() {

    companion object {
        private const val TAG = "HubForegroundService"
        private const val CHANNEL_ID = "fieldmesh_hub"
        private const val NOTIFICATION_ID = 4821

        const val EXTRA_SSID = "ssid"
        const val EXTRA_SPOKES = "spokes"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val ssid = intent?.getStringExtra(EXTRA_SSID)
        val spokes = intent?.getIntExtra(EXTRA_SPOKES, 0) ?: 0

        createChannel()
        val notification = buildNotification(ssid, spokes)

        // Android 10+ requires the service type to be declared at start time,
        // and 14+ rejects the start outright if it does not match the manifest.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        Log.d(TAG, "Hub foreground service started (ssid=$ssid, spokes=$spokes)")

        // Restart if the system kills us: the hub should outlive memory pressure.
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Hub foreground service stopped")
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "FieldMesh sync hub",
            // LOW keeps it silent: this notification is a status indicator that
            // may be up for hours, not an alert.
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while this phone is hosting a FieldMesh site session"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(ssid: String?, spokes: Int): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        val text = when {
            ssid != null && spokes > 0 -> "$ssid · $spokes connected"
            ssid != null -> "$ssid · waiting for devices"
            else -> "Site session running"
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setContentTitle("FieldMesh hub active")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .apply { pendingIntent?.let { setContentIntent(it) } }
            .build()
    }
}
