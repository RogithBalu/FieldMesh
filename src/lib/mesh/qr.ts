/**
 * Session QR: everything a phone needs to join a hotspot site session in one
 * scan — the hub's hotspot credentials, its address on that network, the
 * session key the hub checks, and which inspection document it syncs.
 * A scanned payload is untrusted input from another phone's screen, so every
 * field is validated. Ported from the FieldMesh RN app (v2 adds the passphrase).
 */
export interface SessionInfo {
  /** Hub's IPv4 address on the hotspot subnet. */
  host: string;
  port: number;
  /** Shared secret the hub checks before attaching a spoke. */
  key: string;
  /** Document this session syncs, e.g. "inspection:abc123". */
  doc: string;
  ssid?: string;
  pass?: string;
  /** Host's display name, for the join screen. */
  name?: string;
}

export class SessionQrError extends Error {
  constructor(
    readonly code: 'E_QR_NOT_FIELDMESH' | 'E_QR_BAD_VERSION' | 'E_QR_MALFORMED' | 'E_QR_INVALID_FIELD',
    message: string
  ) {
    super(message);
    this.name = 'SessionQrError';
  }
}

const PREFIX_V2 = 'FMSESSION2:';
const PREFIX_V1 = 'FMSESSION1:';
const MAX_QR_LENGTH = 1024;

function escapeWifiValue(value: string): string {
  return value.replace(/([\;:,"])/g, '\\$1');
}

/** Standard Wi-Fi network QR (what a phone's camera app joins from). */
export function buildWifiQr(ssid: string, passphrase: string): string {
  if (!ssid) throw new SessionQrError('E_QR_INVALID_FIELD', 'ssid is required');
  return `WIFI:T:WPA;S:${escapeWifiValue(ssid)};P:${escapeWifiValue(passphrase)};H:false;;`;
}

export function buildSessionQr(info: SessionInfo): string {
  validate(info);
  const payload: SessionInfo = { host: info.host, port: info.port, key: info.key, doc: info.doc };
  if (info.ssid) payload.ssid = info.ssid;
  if (info.pass) payload.pass = info.pass;
  if (info.name) payload.name = info.name.slice(0, 40);
  return PREFIX_V2 + JSON.stringify(payload);
}

export function parseSessionQr(raw: string): SessionInfo {
  if (typeof raw !== 'string' || raw.length === 0) throw new SessionQrError('E_QR_MALFORMED', 'empty QR payload');
  if (raw.length > MAX_QR_LENGTH) throw new SessionQrError('E_QR_MALFORMED', 'QR payload too large');
  const trimmed = raw.trim();
  if (!trimmed.startsWith('FMSESSION')) throw new SessionQrError('E_QR_NOT_FIELDMESH', 'Not a FieldMesh session code');
  const prefix = trimmed.startsWith(PREFIX_V2) ? PREFIX_V2 : trimmed.startsWith(PREFIX_V1) ? PREFIX_V1 : null;
  if (!prefix) throw new SessionQrError('E_QR_BAD_VERSION', 'Session code from an incompatible app version');
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(prefix.length));
  } catch {
    throw new SessionQrError('E_QR_MALFORMED', 'Session code is not valid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SessionQrError('E_QR_MALFORMED', 'Session code is not valid');
  const o = parsed as Record<string, unknown>;
  const info: SessionInfo = {
    host: typeof o.host === 'string' ? o.host : '',
    port: typeof o.port === 'number' ? o.port : NaN,
    key: typeof o.key === 'string' ? o.key : '',
    doc: typeof o.doc === 'string' ? o.doc : '',
  };
  if (typeof o.ssid === 'string') info.ssid = o.ssid;
  if (typeof o.pass === 'string') info.pass = o.pass;
  if (typeof o.name === 'string') info.name = o.name;
  validate(info);
  return info;
}

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function validate(info: SessionInfo): void {
  if (!info.host || !isIpv4(info.host)) throw new SessionQrError('E_QR_INVALID_FIELD', `host must be an IPv4 address, got "${info.host}"`);
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) throw new SessionQrError('E_QR_INVALID_FIELD', `port must be 1-65535`);
  if (!info.key || info.key.length > 128) throw new SessionQrError('E_QR_INVALID_FIELD', 'key missing');
  if (!info.doc || info.doc.length > 256) throw new SessionQrError('E_QR_INVALID_FIELD', 'doc missing');
  if (info.ssid !== undefined && info.ssid.length > 32) throw new SessionQrError('E_QR_INVALID_FIELD', 'ssid is too long');
  if (info.pass !== undefined && info.pass.length > 64) throw new SessionQrError('E_QR_INVALID_FIELD', 'passphrase is too long');
}

/** Omits I, L, O, 0 and 1 — the pairs that misread when a key is typed by hand. */
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateSessionKey(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let key = '';
  for (let i = 0; i < length; i++) key += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return key;
}

export function inspectionIdFromDoc(doc: string): string | null {
  const m = doc.match(/^inspection:(.+)$/);
  return m ? m[1] : null;
}
