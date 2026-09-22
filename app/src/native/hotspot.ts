/**
 * Thin TS wrapper around the HotspotModule native module.
 *
 * Handles runtime permission requests (ACCESS_FINE_LOCATION on API < 33,
 * NEARBY_WIFI_DEVICES on API 33+) before calling into native.
 *
 * This module is a separate concern from src/transports/ — it provisions
 * the local Wi-Fi network that a later TCP hub will listen on.
 */

import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

const {HotspotModule} = NativeModules;

export interface HotspotInfo {
  ssid: string;
  passphrase: string;
}

/** Error codes surfaced by the native module (match HotspotModule.kt). */
export const HotspotError = {
  ALREADY_ACTIVE: 'E_HOTSPOT_ALREADY_ACTIVE',
  NO_CHANNEL: 'E_HOTSPOT_NO_CHANNEL',
  GENERIC: 'E_HOTSPOT_GENERIC',
  INCOMPATIBLE_MODE: 'E_HOTSPOT_INCOMPATIBLE_MODE',
  TETHERING_DISALLOWED: 'E_HOTSPOT_TETHERING_DISALLOWED',
  NOT_ACTIVE: 'E_HOTSPOT_NOT_ACTIVE',
  WIFI_SERVICE: 'E_WIFI_SERVICE_UNAVAILABLE',
  PERMISSION_DENIED: 'E_HOTSPOT_PERMISSION_DENIED',
  NO_IP: 'E_HOTSPOT_NO_IP',
} as const;

/**
 * Request the appropriate runtime permission for the hotspot API.
 * Returns true if granted, false otherwise.
 */
async function requestHotspotPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const apiLevel = Platform.Version as number;

  if (apiLevel >= 33) {
    // Android 13+ — NEARBY_WIFI_DEVICES replaces location for Wi-Fi APIs.
    const result = await PermissionsAndroid.request(
      'android.permission.NEARBY_WIFI_DEVICES' as any,
      {
        title: 'Nearby Wi-Fi Devices',
        message:
          'FieldMesh needs nearby Wi-Fi device access to create a local hotspot for field sync.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } else {
    // API 26–32 — ACCESS_FINE_LOCATION is required for startLocalOnlyHotspot.
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Location Permission',
        message:
          'FieldMesh needs location access to create a local hotspot for field sync.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
}

/**
 * Start the local-only hotspot.
 * Requests runtime permissions first, then calls into the native module.
 * Rejects with a distinct error code on failure (never throws).
 */
export async function startHotspot(): Promise<HotspotInfo> {
  const granted = await requestHotspotPermission();
  if (!granted) {
    return Promise.reject({
      code: HotspotError.PERMISSION_DENIED,
      message: 'Wi-Fi / location permission denied by user',
    });
  }

  return HotspotModule.startHotspot();
}

/**
 * Stop the active local-only hotspot.
 * Rejects if no hotspot is active.
 */
export async function stopHotspot(): Promise<void> {
  return HotspotModule.stopHotspot();
}

/**
 * This device's IPv4 address on the hotspot subnet — the host a spoke connects
 * to, so it belongs in the session QR. Only meaningful while the hotspot is up.
 */
export async function getHotspotIpAddress(): Promise<string> {
  return HotspotModule.getHotspotIpAddress();
}
