import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Runtime permissions Nearby Connections needs, by Android version:
 *  - 12+ (API 31): BLUETOOTH_SCAN / ADVERTISE / CONNECT
 *  - 13+ (API 33): NEARBY_WIFI_DEVICES
 *  - ≤ 12 (API ≤ 32): fine location (BLE scanning + Wi-Fi)
 */
export async function requestMeshPermissions(): Promise<{ granted: boolean; missing: string[] }> {
  if (Platform.OS !== 'android') return { granted: false, missing: ['android only'] };
  const api = Platform.Version as number;
  const wanted: string[] = [];
  if (api >= 31) wanted.push('android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_ADVERTISE', 'android.permission.BLUETOOTH_CONNECT');
  if (api >= 33) wanted.push('android.permission.NEARBY_WIFI_DEVICES');
  if (api <= 32) wanted.push('android.permission.ACCESS_FINE_LOCATION');

  const results = await PermissionsAndroid.requestMultiple(wanted as never[]);
  const missing = wanted.filter((p) => (results as Record<string, string>)[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: missing.length === 0, missing: missing.map((m) => m.replace('android.permission.', '')) };
}

/** startLocalOnlyHotspot needs fine location up to Android 12 and NEARBY_WIFI_DEVICES from 13. */
export async function requestHotspotPermissions(): Promise<{ granted: boolean; missing: string[] }> {
  if (Platform.OS !== 'android') return { granted: false, missing: ['android only'] };
  const api = Platform.Version as number;
  const wanted: string[] = api >= 33 ? ['android.permission.NEARBY_WIFI_DEVICES'] : ['android.permission.ACCESS_FINE_LOCATION'];
  const results = await PermissionsAndroid.requestMultiple(wanted as never[]);
  const missing = wanted.filter((p) => (results as Record<string, string>)[p] !== PermissionsAndroid.RESULTS.GRANTED);
  return { granted: missing.length === 0, missing: missing.map((m) => m.replace('android.permission.', '')) };
}

/** Android 13+ hides the hub's ongoing notification without POST_NOTIFICATIONS; the hub runs either way. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return true;
  const r = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}
