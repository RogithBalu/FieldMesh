/**
 * Keeping the hub alive while the app is backgrounded or the screen is off.
 *
 * Two separate problems, two mechanisms:
 *   - Android stops background work after a few minutes, killing the hub's
 *     listening socket → foreground service.
 *   - The CPU idles with the screen off even in a foreground service, so
 *     sockets stall → partial wake lock.
 *
 * Both are Android-only; on other platforms every call is a no-op so callers
 * don't need to branch.
 */

import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

const {HubServiceModule} = NativeModules;

export const HubServiceError = {
  START_FAILED: 'E_HUB_SERVICE_START_FAILED',
  WAKE_LOCK: 'E_HUB_WAKE_LOCK_FAILED',
  NOTIFICATION_DENIED: 'E_HUB_NOTIFICATION_DENIED',
} as const;

const isAndroid = Platform.OS === 'android';

/**
 * Android 13+ hides the ongoing notification without POST_NOTIFICATIONS.
 * The service still runs, but the inspector loses the only visible sign that
 * their phone is hosting, so ask before starting.
 */
async function ensureNotificationPermission(): Promise<boolean> {
  if (!isAndroid || (Platform.Version as number) < 33) {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    'android.permission.POST_NOTIFICATIONS' as never,
    {
      title: 'Show hub status',
      message:
        'FieldMesh shows an ongoing notification while this phone is hosting a site session.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export interface HubServiceStatus {
  ssid?: string;
  spokes: number;
}

/**
 * Start the foreground service and take the wake lock.
 * Resolves whether or not the notification permission was granted — a hidden
 * notification is worth less than a dead hub.
 */
export async function startHubService(
  status: HubServiceStatus,
): Promise<{notificationsVisible: boolean}> {
  if (!isAndroid) {
    return {notificationsVisible: false};
  }

  const notificationsVisible = await ensureNotificationPermission();
  await HubServiceModule.startHubService(status.ssid ?? null, status.spokes);
  await HubServiceModule.acquireWakeLock();
  return {notificationsVisible};
}

/** Refresh the notification, e.g. when the connected spoke count changes. */
export async function updateHubService(
  status: HubServiceStatus,
): Promise<void> {
  if (!isAndroid) {
    return;
  }
  await HubServiceModule.updateHubService(status.ssid ?? null, status.spokes);
}

export async function stopHubService(): Promise<void> {
  if (!isAndroid) {
    return;
  }
  // Release the wake lock even if stopping the service fails, so a failure
  // here can't leave the CPU pinned awake.
  try {
    await HubServiceModule.stopHubService();
  } finally {
    await HubServiceModule.releaseWakeLock();
  }
}
