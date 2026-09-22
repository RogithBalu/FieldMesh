/**
 * Site session — what a spoke needs to join a hub, and how it travels as a QR code.
 *
 * Two QR codes are shown at a site:
 *   1. Wi-Fi QR   — standard format, scanned with the phone's own camera/settings
 *                   to join the hub's local-only hotspot.
 *   2. Session QR — scanned inside FieldMesh, carries where the hub listens and
 *                   the key that authorises the spoke.
 */

export interface SessionInfo {
  /** Hub's IPv4 address on the hotspot subnet. */
  host: string;
  /** TCP port the hub is listening on. */
  port: number;
  /** Shared secret the hub checks before attaching a spoke. */
  key: string;
  /** Document this session syncs, e.g. "inspection:abc123". */
  doc: string;
  /** Hotspot SSID, carried for display so a spoke can confirm it joined the right network. */
  ssid?: string;
}

/** Thrown when a scanned session QR can't be trusted. */
export class SessionQrError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SessionQrError';
    this.code = code;
  }
}

export const SessionQrErrorCode = {
  NOT_FIELDMESH: 'E_QR_NOT_FIELDMESH',
  BAD_VERSION: 'E_QR_BAD_VERSION',
  MALFORMED: 'E_QR_MALFORMED',
  INVALID_FIELD: 'E_QR_INVALID_FIELD',
} as const;
