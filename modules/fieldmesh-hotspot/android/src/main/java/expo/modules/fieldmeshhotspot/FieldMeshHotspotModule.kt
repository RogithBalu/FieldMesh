package expo.modules.fieldmeshhotspot

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Wi-Fi hotspot relay for the offline site session.
 *
 *  - Host: WifiManager.startLocalOnlyHotspot() (random SSID/passphrase, no
 *    internet), plus a plain TCP server the spokes connect to.
 *  - Spoke: joins the hotspot with WifiNetworkSpecifier (Android 10+; the
 *    system shows a one-tap consent sheet), binds this process to that network
 *    so sockets use it even though it carries no internet, then opens a TCP
 *    client connection to the hub.
 *  - Byte pipes only: framing, session keys and Yjs sync live in JS.
 *  - A foreground service + wake lock keep the hub alive with the screen off.
 */
class FieldMeshHotspotModule : Module() {
  companion object {
    private const val TAG = "FieldMeshHotspot"
    private const val READ_BUF = 16 * 1024
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())

  private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
  private var wifiCallback: ConnectivityManager.NetworkCallback? = null
  private var legacyNetId: Int = -1
  private var wakeLock: PowerManager.WakeLock? = null

  private var server: ServerSocket? = null
  private val clients = ConcurrentHashMap<String, Socket>()
  private val conns = ConcurrentHashMap<String, Socket>()
  private val counter = AtomicInteger(0)

  private fun emit(name: String, body: Map<String, Any?>) {
    main.post {
      try {
        sendEvent(name, body)
      } catch (e: Exception) {
        Log.w(TAG, "emit $name failed: ${e.message}")
      }
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private fun hotspotIp(): String? {
    var fallback: String? = null
    val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
    for (iface in interfaces) {
      if (!iface.isUp || iface.isLoopback) continue
      for (addr in iface.inetAddresses) {
        if (addr !is Inet4Address || addr.isLoopbackAddress) continue
        val ip = addr.hostAddress ?: continue
        val name = iface.name.lowercase()
        if (name.startsWith("ap") || name.startsWith("softap") || name.startsWith("swlan") || name == "wlan1") return ip
        if (fallback == null && name.startsWith("wlan")) fallback = ip
        if (fallback == null) fallback = ip
      }
    }
    return fallback
  }

  private fun pump(id: String, input: InputStream, event: String, idKey: String, endEvent: String) {
    val buf = ByteArray(READ_BUF)
    try {
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        if (n > 0) {
          val data = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
          emit(event, mapOf(idKey to id, "data" to data))
        }
      }
    } catch (e: Exception) {
      Log.d(TAG, "$id read ended: ${e.message}")
    }
    emit(endEvent, mapOf(idKey to id))
  }

  private fun writeAll(out: OutputStream, bytes: ByteArray) {
    synchronized(out) {
      out.write(bytes)
      out.flush()
    }
  }

  private fun closeQuietly(s: Socket?) {
    try {
      s?.close()
    } catch (_: Exception) {
    }
  }

  private fun stopServerInternal() {
    for ((id, s) in clients) {
      closeQuietly(s)
      clients.remove(id)
    }
    try {
      server?.close()
    } catch (_: Exception) {
    }
    server = null
  }

  private fun unbindWifi() {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    try {
      cm.bindProcessToNetwork(null)
    } catch (_: Exception) {
    }
    wifiCallback?.let {
      try {
        cm.unregisterNetworkCallback(it)
      } catch (_: Exception) {
      }
    }
    wifiCallback = null
    if (legacyNetId >= 0) {
      try {
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        @Suppress("DEPRECATION")
        wm.removeNetwork(legacyNetId)
      } catch (_: Exception) {
      }
      legacyNetId = -1
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FieldMeshHotspot")

    Events(
      "onHotspotStopped",
      "onWifiLost",
      "onClientConnected",
      "onClientDisconnected",
      "onServerData",
      "onData",
      "onDisconnected"
    )

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O }

    // ── Hotspot (host) ──────────────────────────────────────────────────

    AsyncFunction("startHotspot") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.reject("E_HOTSPOT_UNSUPPORTED", "Local-only hotspot needs Android 8+", null)
        return@AsyncFunction
      }
      if (reservation != null) {
        val ip = hotspotIp() ?: ""
        promise.resolve(mapOf("ssid" to currentSsid(), "passphrase" to currentPassphrase(), "ip" to ip))
        return@AsyncFunction
      }
      val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
      if (wm == null) {
        promise.reject("E_WIFI_SERVICE", "WifiManager not available", null)
        return@AsyncFunction
      }
      try {
        wm.startLocalOnlyHotspot(
          object : WifiManager.LocalOnlyHotspotCallback() {
            override fun onStarted(res: WifiManager.LocalOnlyHotspotReservation) {
              reservation = res
              // The AP interface takes a moment to get its address.
              main.postDelayed({
                promise.resolve(mapOf("ssid" to currentSsid(), "passphrase" to currentPassphrase(), "ip" to (hotspotIp() ?: "")))
              }, 700)
            }

            override fun onStopped() {
              reservation = null
              emit("onHotspotStopped", mapOf("reason" to "system"))
            }

            override fun onFailed(reason: Int) {
              reservation = null
              val msg = when (reason) {
                WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL -> "No Wi-Fi channel available for a hotspot"
                WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE -> "Wi-Fi is in an incompatible mode (tethering already on?)"
                WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED -> "Hotspots are disallowed on this device"
                else -> "Hotspot failed (reason $reason)"
              }
              promise.reject("E_HOTSPOT_FAILED", msg, null)
            }
          },
          main
        )
      } catch (e: SecurityException) {
        promise.reject("E_HOTSPOT_PERMISSION", "Missing permission: ${e.message}", e)
      } catch (e: Exception) {
        promise.reject("E_HOTSPOT_FAILED", e.message ?: "startLocalOnlyHotspot failed", e)
      }
    }

    AsyncFunction("stopHotspot") {
      try {
        reservation?.close()
      } catch (_: Exception) {
      }
      reservation = null
    }

    Function("getHotspotIp") { hotspotIp() ?: "" }

    // ── Wi-Fi client (spoke) ────────────────────────────────────────────

    AsyncFunction("joinWifi") { ssid: String, passphrase: String, timeoutMs: Int, promise: Promise ->
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      unbindWifi()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val specifier = WifiNetworkSpecifier.Builder().setSsid(ssid).setWpa2Passphrase(passphrase).build()
        val request = NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .setNetworkSpecifier(specifier)
          .build()
        var settled = false
        val callback = object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            cm.bindProcessToNetwork(network)
            if (!settled) {
              settled = true
              promise.resolve(mapOf("bound" to true))
            }
          }

          override fun onUnavailable() {
            if (!settled) {
              settled = true
              promise.reject("E_WIFI_UNAVAILABLE", "Could not join $ssid (declined or out of range)", null)
            }
          }

          override fun onLost(network: Network) {
            try {
              cm.bindProcessToNetwork(null)
            } catch (_: Exception) {
            }
            emit("onWifiLost", mapOf("ssid" to ssid))
          }
        }
        wifiCallback = callback
        try {
          cm.requestNetwork(request, callback, timeoutMs)
        } catch (e: Exception) {
          wifiCallback = null
          promise.reject("E_WIFI_REQUEST", e.message ?: "requestNetwork failed", e)
        }
      } else {
        // Android 9 and older: legacy WifiConfiguration join.
        try {
          val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
          @Suppress("DEPRECATION")
          val conf = WifiConfiguration().apply {
            SSID = "\"$ssid\""
            preSharedKey = "\"$passphrase\""
          }
          @Suppress("DEPRECATION")
          val id = wm.addNetwork(conf)
          if (id < 0) {
            promise.reject("E_WIFI_LEGACY", "addNetwork failed", null)
            return@AsyncFunction
          }
          legacyNetId = id
          @Suppress("DEPRECATION")
          wm.disconnect()
          @Suppress("DEPRECATION")
          wm.enableNetwork(id, true)
          @Suppress("DEPRECATION")
          wm.reconnect()
          // Poll for a Wi-Fi network to bind to.
          thread {
            val deadline = System.currentTimeMillis() + timeoutMs
            var bound = false
            while (System.currentTimeMillis() < deadline && !bound) {
              for (n in cm.allNetworks) {
                val caps = cm.getNetworkCapabilities(n) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                  cm.bindProcessToNetwork(n)
                  bound = true
                  break
                }
              }
              if (!bound) Thread.sleep(500)
            }
            if (bound) promise.resolve(mapOf("bound" to true))
            else promise.reject("E_WIFI_UNAVAILABLE", "Timed out joining $ssid", null)
          }
        } catch (e: Exception) {
          promise.reject("E_WIFI_LEGACY", e.message ?: "legacy join failed", e)
        }
      }
    }

    AsyncFunction("leaveWifi") {
      unbindWifi()
    }

    // ── TCP server (hub) ────────────────────────────────────────────────

    AsyncFunction("startServer") { port: Int, promise: Promise ->
      stopServerInternal()
      try {
        val ss = ServerSocket()
        ss.reuseAddress = true
        ss.bind(InetSocketAddress("0.0.0.0", port))
        server = ss
        thread(name = "fm-hub-accept") {
          while (true) {
            val sock = try {
              ss.accept()
            } catch (_: Exception) {
              break
            }
            val id = "c${counter.incrementAndGet()}"
            sock.tcpNoDelay = true
            clients[id] = sock
            emit("onClientConnected", mapOf("clientId" to id, "remote" to (sock.inetAddress?.hostAddress ?: "")))
            thread(name = "fm-hub-$id") {
              pump(id, sock.getInputStream(), "onServerData", "clientId", "onClientDisconnected")
              clients.remove(id)
              closeQuietly(sock)
            }
          }
        }
        promise.resolve(mapOf("port" to ss.localPort))
      } catch (e: Exception) {
        promise.reject("E_SERVER", e.message ?: "could not listen on $port", e)
      }
    }

    AsyncFunction("stopServer") {
      stopServerInternal()
    }

    AsyncFunction("sendToClient") { clientId: String, base64: String, promise: Promise ->
      val sock = clients[clientId]
      if (sock == null) {
        promise.reject("E_NOT_CONNECTED", "no client $clientId", null)
        return@AsyncFunction
      }
      thread {
        try {
          writeAll(sock.getOutputStream(), Base64.decode(base64, Base64.NO_WRAP))
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("E_SEND", e.message ?: "send failed", e)
        }
      }
    }

    AsyncFunction("disconnectClient") { clientId: String ->
      closeQuietly(clients.remove(clientId))
    }

    // ── TCP client (spoke) ──────────────────────────────────────────────

    AsyncFunction("connect") { host: String, port: Int, timeoutMs: Int, promise: Promise ->
      thread(name = "fm-connect") {
        val sock = Socket()
        try {
          sock.connect(InetSocketAddress(host, port), timeoutMs)
          sock.tcpNoDelay = true
          val id = "k${counter.incrementAndGet()}"
          conns[id] = sock
          promise.resolve(id)
          pump(id, sock.getInputStream(), "onData", "connId", "onDisconnected")
          conns.remove(id)
          closeQuietly(sock)
        } catch (e: Exception) {
          closeQuietly(sock)
          promise.reject("E_CONNECT", e.message ?: "connect to $host:$port failed", e)
        }
      }
    }

    AsyncFunction("send") { connId: String, base64: String, promise: Promise ->
      val sock = conns[connId]
      if (sock == null) {
        promise.reject("E_NOT_CONNECTED", "no connection $connId", null)
        return@AsyncFunction
      }
      thread {
        try {
          writeAll(sock.getOutputStream(), Base64.decode(base64, Base64.NO_WRAP))
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("E_SEND", e.message ?: "send failed", e)
        }
      }
    }

    AsyncFunction("disconnect") { connId: String ->
      closeQuietly(conns.remove(connId))
    }

    // ── Foreground service + wake lock (keep the hub alive) ─────────────

    AsyncFunction("startHubService") { text: String ->
      val intent = Intent(context, HubForegroundService::class.java).putExtra(HubForegroundService.EXTRA_TEXT, text)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      if (wakeLock?.isHeld != true) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FieldMesh::HubWakeLock").apply {
          setReferenceCounted(false)
          acquire(4 * 60 * 60 * 1000L)
        }
      }
    }

    AsyncFunction("stopHubService") {
      try {
        context.stopService(Intent(context, HubForegroundService::class.java))
      } catch (_: Exception) {
      }
      try {
        wakeLock?.let { if (it.isHeld) it.release() }
      } catch (_: Exception) {
      }
      wakeLock = null
    }

    OnDestroy {
      stopServerInternal()
      for ((id, s) in conns) {
        closeQuietly(s)
        conns.remove(id)
      }
      unbindWifi()
      try {
        reservation?.close()
      } catch (_: Exception) {
      }
      reservation = null
      try {
        wakeLock?.let { if (it.isHeld) it.release() }
      } catch (_: Exception) {
      }
    }
  }

  private fun currentSsid(): String {
    val res = reservation ?: return ""
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      @Suppress("DEPRECATION")
      res.softApConfiguration.ssid ?: ""
    } else {
      @Suppress("DEPRECATION")
      res.wifiConfiguration?.SSID ?: ""
    }
  }

  private fun currentPassphrase(): String {
    val res = reservation ?: return ""
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      res.softApConfiguration.passphrase ?: ""
    } else {
      @Suppress("DEPRECATION")
      res.wifiConfiguration?.preSharedKey ?: ""
    }
  }
}
