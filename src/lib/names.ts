/**
 * Edits carry the author's user id (the server's JWT `sub`, same thing the
 * /resolve endpoint writes). There is no "get user by id" endpoint, so names
 * are learned from the session user and from Hocuspocus awareness (teammates
 * broadcast their name while an inspection is open) and cached on-device.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fieldmesh:names';
let cache: Record<string, string> = {};
let loaded = false;

export async function loadNames(): Promise<void> {
  if (loaded) return;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}');
  } catch {
    cache = {};
  }
  loaded = true;
}

export function rememberName(id: string | undefined, name: string | undefined): void {
  if (!id || !name || cache[id] === name) return;
  cache[id] = name;
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export function nameFor(id: string | null | undefined, fallback?: string): string {
  if (!id) return fallback ?? 'Unknown';
  if (cache[id]) return cache[id];
  if (id === 'server') return 'Server';
  return fallback ?? `Operator ${id.slice(0, 6)}`;
}
