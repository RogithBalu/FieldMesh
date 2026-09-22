package com.fieldmeshapp

import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.content.Context
import android.util.Log
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS control over the hub's foreground service and wake lock.
 *
 * Exposes:
 *   startHubService(ssid, spokes)  → keep the hub alive in the background
 *   updateHubService(ssid, spokes) → refresh the notification text
 *   stopHubService()               → release it
 *   acquireWakeLock() / releaseWakeLock()
 */
class HubServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "HubServiceModule"
        private const val WAKE_LOCK_TAG = "FieldMesh::HubWakeLock"

        const val E_SERVICE_START = "E_HUB_SERVICE_START_FAILED"
        const val E_WAKE_LOCK = "E_HUB_WAKE_LOCK_FAILED"
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var serviceRunning = false

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "HubServiceModule"

    @ReactMethod
    fun startHubService(ssid: String?, spokes: Int, promise: Promise) {
        try {
            val intent = Intent(reactContext, HubForegroundService::class.java).apply {
                putExtra(HubForegroundService.EXTRA_SSID, ssid)
                putExtra(HubForegroundService.EXTRA_SPOKES, spokes)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            serviceRunning = true
            promise.resolve(null)
        } catch (e: Exception) {
            // Android 12+ throws if started from the background without an
            // allowed exemption; surface that rather than failing silently.
            Log.e(TAG, "Failed to start hub service", e)
            promise.reject(E_SERVICE_START, "Failed to start hub service: ${e.message}")
        }
    }

    /** Same intent, new extras — the service re-renders its notification. */
    @ReactMethod
    fun updateHubService(ssid: String?, spokes: Int, promise: Promise) {
        if (!serviceRunning) {
            promise.resolve(null)
            return
        }
        startHubService(ssid, spokes, promise)
    }

    @ReactMethod
    fun stopHubService(promise: Promise) {
        try {
            reactContext.stopService(
                Intent(reactContext, HubForegroundService::class.java),
            )
            serviceRunning = false
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject(E_SERVICE_START, "Failed to stop hub service: ${e.message}")
        }
    }

    /**
     * Hold the CPU awake so the hub keeps servicing sockets with the screen off.
     * The foreground service prevents the process being killed; it does not stop
     * the CPU idling.
     */
    @ReactMethod
    fun acquireWakeLock(promise: Promise) {
        try {
            if (wakeLock?.isHeld == true) {
                promise.resolve(null)
                return
            }
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
                setReferenceCounted(false)
                acquire()
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject(E_WAKE_LOCK, "Failed to acquire wake lock: ${e.message}")
        }
    }

    @ReactMethod
    fun releaseWakeLock(promise: Promise) {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
            wakeLock = null
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject(E_WAKE_LOCK, "Failed to release wake lock: ${e.message}")
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    override fun onHostResume() {}
    override fun onHostPause() {}

    /**
     * Release the wake lock if the app is destroyed while holding it; a leaked
     * PARTIAL_WAKE_LOCK drains the battery with nothing running.
     */
    override fun onHostDestroy() {
        releaseWakeLockQuietly()
    }

    override fun onCatalystInstanceDestroy() {
        releaseWakeLockQuietly()
        super.onCatalystInstanceDestroy()
    }

    private fun releaseWakeLockQuietly() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wakeLock = null
    }
}
