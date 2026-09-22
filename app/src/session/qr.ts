/**
 * Building and parsing the two QR codes a site session needs.
 *
 * A scanned session QR is untrusted input from another device's screen, so
 * parseSessionQr validates every field rather than trusting the payload.
 */

import {
  SessionInfo,
  SessionQrError,
  SessionQrErrorCode as Code,
} from './types';

/** Magic prefix + schema version. Bump the digit when the payload shape changes. */
const SESSION_PREFIX = 'FMSESSION1:';

const MAX_QR_LENGTH = 1024;
const MAX_KEY_LENGTH = 128;
const MAX_DOC_LENGTH = 256;
const MAX_SSID_LENGTH = 32;

// ─── Wi-Fi QR ────────────────────────────────────────────────────────────────

/**
 * `;`, `:`, `,`, `"` and `\` are field separators in the Wi-Fi QR grammar and
 * must be backslash-escaped inside a value, or a passphrase containing one
 * silently truncates the payload.
 */
function escapeWifiValue(value: string): string {
  return value.replace(/([\\;:,"])/g, '\\$1');
}

/**
 * Standard Wi-Fi network QR, the format Android and iOS cameras join networks from.
 * Local-only hotspots are always WPA2 and never hidden.
 */
export function buildWifiQr(ssid: string, passphrase: string): string {
  if (!ssid) {
    throw new SessionQrError(Code.INVALID_FIELD, 'ssid is required');
  }
  return `WIFI:T:WPA;S:${escapeWifiValue(ssid)};P:${escapeWifiValue(
    passphrase,
  )};H:false;;`;
}

// ─── Session QR ──────────────────────────────────────────────────────────────

export function buildSessionQr(info: SessionInfo): string {
  validateSessionInfo(info);
  const payload: SessionInfo = {
    host: info.host,
    port: info.port,
    key: info.key,
    doc: info.doc,
  };
  if (info.ssid) {
    payload.ssid = info.ssid;
  }
  return SESSION_PREFIX + JSON.stringify(payload);
}

export function parseSessionQr(raw: string): SessionInfo {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new SessionQrError(Code.MALFORMED, 'empty QR payload');
  }
  if (raw.length > MAX_QR_LENGTH) {
    throw new SessionQrError(Code.MALFORMED, 'QR payload too large');
  }

  const trimmed = raw.trim();

  if (!trimmed.startsWith('FMSESSION')) {
    throw new SessionQrError(
      Code.NOT_FIELDMESH,
      'not a FieldMesh session QR code',
    );
  }
  if (!trimmed.startsWith(SESSION_PREFIX)) {
    throw new SessionQrError(
      Code.BAD_VERSION,
      'session QR was made by an incompatible app version',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(SESSION_PREFIX.length));
  } catch {
    throw new SessionQrError(Code.MALFORMED, 'session QR payload is not JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SessionQrError(Code.MALFORMED, 'session payload is not an object');
  }

  const info = parsed as Record<string, unknown>;
  const result: SessionInfo = {
    host: typeof info.host === 'string' ? info.host : '',
    port: typeof info.port === 'number' ? info.port : NaN,
    key: typeof info.key === 'string' ? info.key : '',
    doc: typeof info.doc === 'string' ? info.doc : '',
  };
  if (typeof info.ssid === 'string') {
    result.ssid = info.ssid;
  }

  validateSessionInfo(result);
  return result;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Dotted-quad only: a hub always advertises its address on the hotspot subnet. */
function isIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function validateSessionInfo(info: SessionInfo): void {
  if (!info.host || !isIpv4(info.host)) {
    throw new SessionQrError(
      Code.INVALID_FIELD,
      `host must be an IPv4 address, got "${info.host}"`,
    );
  }
  if (
    !Number.isInteger(info.port) ||
    info.port < 1 ||
    info.port > 65535
  ) {
    throw new SessionQrError(
      Code.INVALID_FIELD,
      `port must be 1-65535, got ${info.port}`,
    );
  }
  if (!info.key || info.key.length > MAX_KEY_LENGTH) {
    throw new SessionQrError(
      Code.INVALID_FIELD,
      'key must be non-empty and at most 128 characters',
    );
  }
  if (!info.doc || info.doc.length > MAX_DOC_LENGTH) {
    throw new SessionQrError(
      Code.INVALID_FIELD,
      'doc must be non-empty and at most 256 characters',
    );
  }
  if (info.ssid !== undefined && info.ssid.length > MAX_SSID_LENGTH) {
    throw new SessionQrError(Code.INVALID_FIELD, 'ssid is too long');
  }
}

// ─── Session key ─────────────────────────────────────────────────────────────

/** Omits I, L, O, 0 and 1 — the pairs that misread when a key is typed by hand. */
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Session key for a single site session.
 *
 * This is a second factor behind the hotspot's own WPA2 passphrase, not the
 * primary boundary: a spoke must already be on the local-only hotspot to reach
 * the hub at all. The alphabet omits characters that misread when someone types
 * the key by hand after a failed scan.
 */
export function generateSessionKey(length = 12): string {
  let key = '';
  for (let i = 0; i < length; i++) {
    key += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
  }
  return key;
}
