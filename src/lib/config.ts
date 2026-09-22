/**
 * Where the app talks to the FieldMesh server.
 *
 * Resolution order:
 *   1. A server override the user entered in-app (Mesh → "Join another session"),
 *      persisted in AsyncStorage so it survives restarts.
 *   2. EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WS_URL from .env (baked in at bundle time).
 *      Set EXPO_PUBLIC_API_URL=dev to talk to a backend on the Expo dev-server
 *      host instead (port 3000 REST, 1234 Hocuspocus) during local development.
 *   3. The production server on AWS Lightsail (DEFAULT_SERVER below).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const OVERRIDE_KEY = 'fieldmesh:serverOverride';
export const REST_PORT = 3000;
export const WS_PORT = 1234;

/** FieldMesh server on AWS Lightsail (static IP) — used unless overridden. */
export const DEFAULT_SERVER = {
  apiUrl: 'http://98.80.162.7:3000',
  wsUrl: 'ws://98.80.162.7:1234',
} as const;

let override: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

export async function loadServerConfig(): Promise<void> {
  if (loaded) return;
  try {
    override = (await AsyncStorage.getItem(OVERRIDE_KEY)) || null;
  } catch {
    override = null;
  }
  loaded = true;
}

export function getServerOverride(): string | null {
  return override;
}

export async function setServerOverride(raw: string | null): Promise<void> {
  const normalised = raw ? normalizeServerInput(raw) : null;
  override = normalised;
  if (normalised) await AsyncStorage.setItem(OVERRIDE_KEY, normalised);
  else await AsyncStorage.removeItem(OVERRIDE_KEY);
  listeners.forEach((l) => l());
}

export function onServerConfigChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** "98.80.162.7" → "http://98.80.162.7:3000"; full URLs pass through (trailing slash stripped). */
export function normalizeServerInput(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  const hasPort = /:\d+$/.test(s.replace(/^https?:\/\//i, ''));
  if (!hasPort) s = `${s}:${REST_PORT}`;
  return s;
}

function devServerHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
  if (!hostUri) return null;
  return hostUri.split(':')[0] || null;
}

export type ServerSource = 'override' | 'env' | 'dev' | 'default';

export function describeServer(): { apiUrl: string; wsUrl: string; source: ServerSource } {
  if (override) {
    return { apiUrl: override, wsUrl: deriveWsUrl(override), source: 'override' };
  }
  const envApi = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envApi && envApi.toLowerCase() === 'dev') {
    const host = devServerHost() ?? 'localhost';
    return { apiUrl: `http://${host}:${REST_PORT}`, wsUrl: `ws://${host}:${WS_PORT}`, source: 'dev' };
  }
  if (envApi) {
    const apiUrl = envApi.replace(/\/+$/, '');
    const envWs = process.env.EXPO_PUBLIC_WS_URL?.trim();
    return { apiUrl, wsUrl: envWs ? envWs.replace(/\/+$/, '') : deriveWsUrl(apiUrl), source: 'env' };
  }
  return { apiUrl: DEFAULT_SERVER.apiUrl, wsUrl: DEFAULT_SERVER.wsUrl, source: 'default' };
}

export function getApiUrl(): string {
  return describeServer().apiUrl;
}

export function getWsUrl(): string {
  return describeServer().wsUrl;
}

/** Hocuspocus listens on its own port; swap scheme and port from the REST URL. */
export function deriveWsUrl(apiUrl: string): string {
  const m = apiUrl.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i);
  if (!m) return apiUrl;
  const scheme = m[1].toLowerCase() === 'https' ? 'wss' : 'ws';
  return `${scheme}://${m[2]}:${WS_PORT}`;
}
