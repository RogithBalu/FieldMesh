package com.fieldmeshapp

import android.content.Context
import android.net.wifi.WifiManager
import android.net.wifi.WifiManager.LocalOnlyHotspotCallback
import android.net.wifi.WifiManager.LocalOnlyHotspotReservation
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Native module wrapping WifiManager.startLocalOnlyHotspot().
 *
 * Exposes to JS:
 *   startHotspot(promise)  → resolves { ssid, passphrase, band }
 *   stopHotspot(promise)   → resolves void
 *
 * Holds the LocalOnlyHotspotReservation as a module-level field and
 * releases it on activity destroy to avoid leaking the AP.
 */
class HotspotModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "HotspotModule"

        // JS-catchable error codes (distinct per failure reason)
        const val E_ALREADY_ACTIVE     = "E_HOTSPOT_ALREADY_ACTIVE"
        const val E_NO_CHANNEL         = "E_HOTSPOT_NO_CHANNEL"
        const val E_GENERIC            = "E_HOTSPOT_GENERIC"
        const val E_INCOMPATIBLE_MODE  = "E_HOTSPOT_INCOMPATIBLE_MODE"
        const val E_TETHERING_DISALLOW = "E_HOTSPOT_TETHERING_DISALLOWED"
        const val E_NOT_ACTIVE         = "E_HOTSPOT_NOT_ACTIVE"
        const val E_WIFI_SERVICE       = "E_WIFI_SERVICE_UNAVAILABLE"
        const val E_NO_IP              = "E_HOTSPOT_NO_IP"
    }

    private var reservation: LocalOnlyHotspotReservation? = null

    override fun getName(): String = "HotspotModule"

    init {
        reactContext.addLifecycleEventListener(this)
    }

    // ── JS-exposed methods ─────────────────────────────────────────────────

    @ReactMethod
    fun startHotspot(promise: Promise) {
        if (reservation != null) {
            promise.reject(E_ALREADY_ACTIVE, "Hotspot is already active")
            return
        }

        val wifiManager = reactApplicationContext
            .applicationContext
            .getSystemService(Context.WIFI_SERVICE) as? WifiManager

        if (wifiManager == null) {
            promise.reject(E_WIFI_SERVICE, "WifiManager service not available")
            return
        }

        try {
            wifiManager.startLocalOnlyHotspot(
                object : LocalOnlyHotspotCallback() {
                    override fun onStarted(res: LocalOnlyHotspotReservation) {
                        Log.d(TAG, "Local-only hotspot started")
                        reservation = res

                        val result = Arguments.createMap()

                        // API 30+ uses SoftApConfiguration; pre-30 uses WifiConfiguration.
                        // SoftApConfiguration.getBand() and its BAND_* constants are
                        // @SystemApi, so the band is not readable by a normal app.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                            val config = res.softApConfiguration
                            result.putString("ssid", config.ssid ?: "")
                            result.putString("passphrase", config.passphrase ?: "")
                        } else {
                            @Suppress("DEPRECATION")
                            val config = res.wifiConfiguration
                            result.putString("ssid", config?.SSID ?: "")
                            result.putString("passphrase", config?.preSharedKey ?: "")
                        }

                        promise.resolve(result)
                    }

                    override fun onStopped() {
                        Log.d(TAG, "Local-only hotspot stopped by system")
                        reservation = null
                    }

                    override fun onFailed(reason: Int) {
                        Log.e(TAG, "Local-only hotspot failed, reason=$reason")
                        reservation = null
                        val (code, msg) = mapFailureReason(reason)
                        promise.reject(code, msg)
                    }
                },
                Handler(Looper.getMainLooper())
            )
        } catch (e: SecurityException) {
            promise.reject(E_GENERIC, "Missing permission: ${e.message}")
        } catch (e: Exception) {
            promise.reject(E_GENERIC, "startLocalOnlyHotspot threw: ${e.message}")
        }
    }

    /**
     * IPv4 address of this device on the local-only hotspot, for the session QR.
     *
     * The AP interface is not the default route (a local-only hotspot carries no
     * internet), so this scans interfaces rather than asking for the outbound
     * address, which would return the phone's mobile/Wi-Fi client address instead.
     */
    @ReactMethod
    fun getHotspotIpAddress(promise: Promise) {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: run {
                promise.reject(E_NO_IP, "No network interfaces available")
                return
            }

            var fallback: String? = null

            for (iface in interfaces) {
                if (!iface.isUp || iface.isLoopback) continue

                for (addr in iface.inetAddresses) {
                    if (addr !is Inet4Address || addr.isLoopbackAddress) continue
                    val ip = addr.hostAddress ?: continue

                    // Android names the local-only hotspot interface ap*/softap*;
                    // swlan* and wlan1 appear on some vendor builds (incl. Samsung).
                    val name = iface.name.lowercase()
                    if (name.startsWith("ap") ||
                        name.startsWith("softap") ||
                        name.startsWith("swlan") ||
                        name == "wlan1"
                    ) {
                        promise.resolve(ip)
                        return
                    }
                    if (fallback == null) fallback = ip
                }
            }

            if (fallback != null) {
                Log.w(TAG, "No AP interface matched; falling back to $fallback")
                promise.resolve(fallback)
            } else {
                promise.reject(E_NO_IP, "No non-loopback IPv4 address found")
            }
        } catch (e: Exception) {
            promise.reject(E_NO_IP, "Failed to read network interfaces: ${e.message}")
        }
    }

    @ReactMethod
    fun stopHotspot(promise: Promise) {
        val res = reservation
        if (res == null) {
            promise.reject(E_NOT_ACTIVE, "No active hotspot reservation to stop")
            return
        }
        try {
            res.close()
            reservation = null
            Log.d(TAG, "Local-only hotspot closed by JS")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject(E_GENERIC, "Failed to close hotspot: ${e.message}")
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    override fun onHostResume() {}
    override fun onHostPause() {}

    override fun onHostDestroy() {
        // Release the AP if the activity is killed while hotspot is active.
        reservation?.let {
            Log.d(TAG, "Activity destroyed — releasing hotspot reservation")
            try { it.close() } catch (_: Exception) {}
            reservation = null
        }
    }

    override fun onCatalystInstanceDestroy() {
        // Belt-and-suspenders: also release on catalyst teardown.
        reservation?.let {
            Log.d(TAG, "Catalyst destroyed — releasing hotspot reservation")
            try { it.close() } catch (_: Exception) {}
            reservation = null
        }
        super.onCatalystInstanceDestroy()
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun mapFailureReason(reason: Int): Pair<String, String> {
        return when (reason) {
            LocalOnlyHotspotCallback.ERROR_NO_CHANNEL ->
                E_NO_CHANNEL to "No available Wi-Fi channel for hotspot"
            LocalOnlyHotspotCallback.ERROR_GENERIC ->
                E_GENERIC to "Generic hotspot failure"
            LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE ->
                E_INCOMPATIBLE_MODE to "Wi-Fi is in an incompatible mode (e.g. tethering active)"
            LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED ->
                E_TETHERING_DISALLOW to "Tethering is disallowed by the carrier or device policy"
            else ->
                E_GENERIC to "Unknown hotspot failure (reason=$reason)"
        }
    }

}
