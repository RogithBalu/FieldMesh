import * as SecureStore from 'expo-secure-store';

const KEY = 'fieldmesh_device_id';

/** Stable per-install device id — becomes the HLC node and EditEntry.device. */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) {
    id = `device-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    await SecureStore.setItemAsync(KEY, id);
  }
  return id;
}
