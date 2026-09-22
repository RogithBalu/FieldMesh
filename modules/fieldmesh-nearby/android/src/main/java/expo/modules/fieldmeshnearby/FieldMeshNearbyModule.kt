package expo.modules.fieldmeshnearby

import android.content.Context
import android.util.Base64
import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.BandwidthInfo
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google Nearby Connections for the offline site mesh.
 *
 * Every phone on an inspection both advertises and discovers under a service
 * id derived from the inspection, so phones with no network between them
 * still find each other. Nearby chooses the radio (BLE for discovery, then
 * Bluetooth or Wi-Fi Direct / hotspot for bandwidth) and reports upgrades via
 * onBandwidthChanged, which the app shows as each peer's "medium".
 *
 * P2P_CLUSTER: a phone may hold several links at once, so one that also has
 * internet relays for the others (same Y.Doc, one YjsSync per link).
 *
 * Bytes cross to JS as base64; BYTES payloads cap at ~32 KB, so the JS
 * transport chunks larger frames.
 */
class FieldMeshNearbyModule : Module() {
  companion object {
    private const val TAG = "FieldMeshNearby"
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val client by lazy { Nearby.getConnectionsClient(context) }
  private val connected = HashMap<String, String>()
  private val pendingNames = HashMap<String, String>()

  private fun emit(name: String, body: Map<String, Any?>) {
    try {
      sendEvent(name, body)
    } catch (e: Exception) {
      Log.w(TAG, "emit $name failed: ${e.message}")
    }
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes() ?: return
      emit("onPayload", mapOf("endpointId" to endpointId, "data" to Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      // BYTES payloads arrive whole in onPayloadReceived.
    }
  }

  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      // Auto-accept: identities are exchanged and checked by the layer above.
      pendingNames[endpointId] = info.endpointName
      client.acceptConnection(endpointId, payloadCallback)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      val name = pendingNames.remove(endpointId) ?: ""
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        connected[endpointId] = name
        emit("onConnected", mapOf("endpointId" to endpointId, "name" to name))
      } else {
        emit(
          "onDisconnected",
          mapOf("endpointId" to endpointId, "name" to name, "reason" to "rejected:${result.status.statusCode}")
        )
      }
    }

    override fun onDisconnected(endpointId: String) {
      val name = connected.remove(endpointId) ?: ""
      emit("onDisconnected", mapOf("endpointId" to endpointId, "name" to name, "reason" to "disconnected"))
    }

    override fun onBandwidthChanged(endpointId: String, bandwidthInfo: BandwidthInfo) {
      emit("onBandwidthChanged", mapOf("endpointId" to endpointId, "quality" to bandwidthInfo.quality))
    }
  }

  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      emit("onEndpointFound", mapOf("endpointId" to endpointId, "name" to info.endpointName, "serviceId" to info.serviceId))
    }

    override fun onEndpointLost(endpointId: String) {
      emit("onEndpointLost", mapOf("endpointId" to endpointId))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FieldMeshNearby")

    Events("onEndpointFound", "onEndpointLost", "onConnected", "onDisconnected", "onPayload", "onBandwidthChanged")

    Function("isAvailable") {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    Function("connectedEndpoints") {
      connected.entries.map { mapOf("endpointId" to it.key, "name" to it.value) }
    }

    AsyncFunction("startAdvertising") { serviceId: String, endpointName: String, promise: Promise ->
      client
        .startAdvertising(
          endpointName,
          serviceId,
          lifecycle,
          AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()
        )
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e ->
          Log.e(TAG, "startAdvertising failed", e)
          promise.reject("E_NEARBY_ADVERTISE", e.message ?: "advertising failed", e)
        }
    }

    AsyncFunction("startDiscovery") { serviceId: String, promise: Promise ->
      client
        .startDiscovery(serviceId, discovery, DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build())
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e ->
          Log.e(TAG, "startDiscovery failed", e)
          promise.reject("E_NEARBY_DISCOVER", e.message ?: "discovery failed", e)
        }
    }

    AsyncFunction("stopAdvertising") {
      client.stopAdvertising()
    }

    AsyncFunction("stopDiscovery") {
      client.stopDiscovery()
    }

    AsyncFunction("requestConnection") { endpointName: String, endpointId: String, promise: Promise ->
      client
        .requestConnection(endpointName, endpointId, lifecycle)
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e ->
          Log.w(TAG, "requestConnection to $endpointId failed", e)
          promise.reject("E_NEARBY_CONNECT", e.message ?: "connect failed", e)
        }
    }

    AsyncFunction("sendPayload") { endpointId: String, base64: String, promise: Promise ->
      if (!connected.containsKey(endpointId)) {
        promise.reject("E_NEARBY_NOT_CONNECTED", "not connected to $endpointId", null)
        return@AsyncFunction
      }
      try {
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        client
          .sendPayload(endpointId, Payload.fromBytes(bytes))
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { e -> promise.reject("E_NEARBY_SEND", e.message ?: "send failed", e) }
      } catch (e: Exception) {
        promise.reject("E_NEARBY_SEND", "send failed: ${e.message}", e)
      }
    }

    AsyncFunction("disconnect") { endpointId: String ->
      client.disconnectFromEndpoint(endpointId)
      connected.remove(endpointId)
    }

    AsyncFunction("stopAll") {
      try {
        client.stopAllEndpoints()
        client.stopAdvertising()
        client.stopDiscovery()
      } catch (e: Exception) {
        Log.w(TAG, "stopAll: ${e.message}")
      }
      connected.clear()
      pendingNames.clear()
    }

    OnDestroy {
      try {
        client.stopAllEndpoints()
        client.stopAdvertising()
        client.stopDiscovery()
      } catch (_: Exception) {
      }
      connected.clear()
    }
  }
}
