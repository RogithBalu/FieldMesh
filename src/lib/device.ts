import * as SecureStore from 'expo-secure-store';

const KEY = 'fieldmesh_device_id';

/** Stable per-install device id — becomes the HLC node and EditEntry.device. */
export async function getDeviceId(): Promise<string> {
  let id: string | null = null;
  try {
    id = await SecureStore.getItemAsync(KEY);
  } catch {
    id = null;
  }
  if (!id) {
    const rand = new Uint8Array(6);
    globalThis.crypto.getRandomValues(rand);
    id = `dev-${Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    try {
      await SecureStore.setItemAsync(KEY, id);
    } catch {
      // SecureStore unavailable (web/preview) — a per-session id still works.
    }
  }
  return id;
}
