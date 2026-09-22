package com.fieldmeshapp

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
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

/**
 * Google Nearby Connections, used to reach phones outside the hub's Wi-Fi range.
 *
 * Nearby picks its own radio (Bluetooth, BLE, Wi-Fi Direct) and can connect two
 * phones with no network between them, which is what lets a phone in range of
 * the hub relay for one that isn't.
 *
 * P2P_CLUSTER is deliberate: P2P_STAR would allow only one connection per
 * device, and a bridge needs to hold its uplink and several downlinks at once.
 *
 * Bytes cross the bridge as base64 — the RN bridge cannot carry a byte array
 * directly, and Nearby's BYTES payloads cap at ~32 KB, which the framing layer
 * above already stays under.
 */
class NearbyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "NearbyModule"
        private const val SERVICE_ID = "com.fieldmeshapp.session"

        const val E_ADVERTISE = "E_NEARBY_ADVERTISE_FAILED"
        const val E_DISCOVER = "E_NEARBY_DISCOVER_FAILED"
        const val E_CONNECT = "E_NEARBY_CONNECT_FAILED"
        const val E_SEND = "E_NEARBY_SEND_FAILED"
        const val E_NOT_CONNECTED = "E_NEARBY_NOT_CONNECTED"

        // Emitted to JS.
        const val EV_ENDPOINT_FOUND = "nearbyEndpointFound"
        const val EV_ENDPOINT_LOST = "nearbyEndpointLost"
        const val EV_CONNECTED = "nearbyConnected"
        const val EV_DISCONNECTED = "nearbyDisconnected"
        const val EV_PAYLOAD = "nearbyPayload"
    }

    private val client by lazy { Nearby.getConnectionsClient(reactContext) }
    private val connected = mutableSetOf<String>()

    override fun getName(): String = "NearbyModule"

    private fun emit(event: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }

    // ── Callbacks ──────────────────────────────────────────────────────────

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            emit(
                EV_PAYLOAD,
                Arguments.createMap().apply {
                    putString("endpointId", endpointId)
                    putString("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
                },
            )
        }

        override fun onPayloadTransferUpdate(
            endpointId: String,
            update: PayloadTransferUpdate,
        ) {
            // BYTES payloads arrive whole in onPayloadReceived; nothing to track.
        }
    }

    private val connectionLifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // Auto-accept: both sides already share a session key at the
            // transport layer above, and a field user cannot confirm a code on
            // a phone that is in someone else's pocket.
            client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
                connected.add(endpointId)
                emit(
                    EV_CONNECTED,
                    Arguments.createMap().apply { putString("endpointId", endpointId) },
                )
            } else {
                emit(
                    EV_DISCONNECTED,
                    Arguments.createMap().apply {
                        putString("endpointId", endpointId)
                        putString("reason", "connection rejected: ${result.status.statusCode}")
                    },
                )
            }
        }

        override fun onDisconnected(endpointId: String) {
            connected.remove(endpointId)
            emit(
                EV_DISCONNECTED,
                Arguments.createMap().apply {
                    putString("endpointId", endpointId)
                    putString("reason", "disconnected")
                },
            )
        }
    }

    private val discoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            emit(
                EV_ENDPOINT_FOUND,
                Arguments.createMap().apply {
                    putString("endpointId", endpointId)
                    putString("name", info.endpointName)
                },
            )
        }

        override fun onEndpointLost(endpointId: String) {
            emit(
                EV_ENDPOINT_LOST,
                Arguments.createMap().apply { putString("endpointId", endpointId) },
            )
        }
    }

    // ── JS API ─────────────────────────────────────────────────────────────

    /** Become reachable as a bridge for phones out of hotspot range. */
    @ReactMethod
    fun startAdvertising(deviceName: String, promise: Promise) {
        client
            .startAdvertising(
                deviceName,
                SERVICE_ID,
                connectionLifecycle,
                AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build(),
            )
            .addOnSuccessListener { promise.resolve(null) }
            .addOnFailureListener { e ->
                Log.e(TAG, "startAdvertising failed", e)
                promise.reject(E_ADVERTISE, e.message ?: "advertising failed")
            }
    }

    /** Look for a bridge to relay through. */
    @ReactMethod
    fun startDiscovery(promise: Promise) {
        client
            .startDiscovery(
                SERVICE_ID,
                discoveryCallback,
                DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build(),
            )
            .addOnSuccessListener { promise.resolve(null) }
            .addOnFailureListener { e ->
                Log.e(TAG, "startDiscovery failed", e)
                promise.reject(E_DISCOVER, e.message ?: "discovery failed")
            }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        client.stopAdvertising()
        promise.resolve(null)
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        client.stopDiscovery()
        promise.resolve(null)
    }

    @ReactMethod
    fun requestConnection(deviceName: String, endpointId: String, promise: Promise) {
        client
            .requestConnection(deviceName, endpointId, connectionLifecycle)
            .addOnSuccessListener { promise.resolve(null) }
            .addOnFailureListener { e ->
                Log.e(TAG, "requestConnection failed", e)
                promise.reject(E_CONNECT, e.message ?: "connect failed")
            }
    }

    /** @param base64 frame bytes, already length-prefixed by the layer above. */
    @ReactMethod
    fun sendPayload(endpointId: String, base64: String, promise: Promise) {
        if (!connected.contains(endpointId)) {
            promise.reject(E_NOT_CONNECTED, "not connected to $endpointId")
            return
        }
        try {
            val bytes = Base64.decode(base64, Base64.NO_WRAP)
            client
                .sendPayload(endpointId, Payload.fromBytes(bytes))
                .addOnSuccessListener { promise.resolve(null) }
                .addOnFailureListener { e ->
                    promise.reject(E_SEND, e.message ?: "send failed")
                }
        } catch (e: Exception) {
            promise.reject(E_SEND, "send failed: ${e.message}")
        }
    }

    @ReactMethod
    fun disconnect(endpointId: String, promise: Promise) {
        client.disconnectFromEndpoint(endpointId)
        connected.remove(endpointId)
        promise.resolve(null)
    }

    @ReactMethod
    fun stopAll(promise: Promise) {
        client.stopAllEndpoints()
        connected.clear()
        promise.resolve(null)
    }

    // RCTDeviceEventEmitter requires these to exist; the bookkeeping is JS-side.
    @ReactMethod
    fun addListener(eventName: String) = Unit

    @ReactMethod
    fun removeListeners(count: Int) = Unit
}
