/**
 * Wire format for photo transfer.
 *
 * Photos are the only payload large enough that restarting from zero after a
 * dropped link is unacceptable — a 5 MB photo over a field hotspot can take
 * long enough to span a walk out of range. So transfer is chunked and the
 * receiver, not the sender, decides where to start.
 *
 * Four messages:
 *   META   sender   → receiver  what is coming
 *   RESUME receiver → sender    the first chunk index it still needs
 *   CHUNK  sender   → receiver  one slice of the file
 *   ACK    receiver → sender    complete (and whether it verified)
 *
 * META/RESUME/ACK are small and infrequent, so they are JSON. CHUNK is packed
 * binary: JSON would base64 the bytes and cost a third more on the wire.
 */

export interface PhotoMeta {
  photoId: string;
  /** Total bytes in the photo. */
  size: number;
  chunkSize: number;
  /** Lowercase hex SHA-256, for the receiver to verify against. */
  sha256?: string;
  name?: string;
}

export interface PhotoResume {
  photoId: string;
  /** First chunk index the receiver still needs. */
  nextIndex: number;
}

export interface PhotoAck {
  photoId: string;
  ok: boolean;
  reason?: string;
}

export class PhotoProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoProtocolError';
  }
}

const MAX_JSON_BYTES = 8192;
const MAX_ID_BYTES = 255;

// ─── JSON messages ───────────────────────────────────────────────────────────

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function decodeJson(payload: Uint8Array): unknown {
  if (payload.length > MAX_JSON_BYTES) {
    throw new PhotoProtocolError('photo control message too large');
  }
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new PhotoProtocolError('photo control message is not valid JSON');
  }
}

export function encodeMeta(meta: PhotoMeta): Uint8Array {
  return encodeJson(meta);
}

export function decodeMeta(payload: Uint8Array): PhotoMeta {
  const v = decodeJson(payload) as Record<string, unknown>;
  if (
    typeof v?.photoId !== 'string' ||
    v.photoId.length === 0 ||
    typeof v.size !== 'number' ||
    !Number.isInteger(v.size) ||
    v.size < 0 ||
    typeof v.chunkSize !== 'number' ||
    !Number.isInteger(v.chunkSize) ||
    v.chunkSize <= 0
  ) {
    throw new PhotoProtocolError('malformed photo META');
  }
  const meta: PhotoMeta = {
    photoId: v.photoId,
    size: v.size,
    chunkSize: v.chunkSize,
  };
  if (typeof v.sha256 === 'string') meta.sha256 = v.sha256;
  if (typeof v.name === 'string') meta.name = v.name;
  return meta;
}

export function encodeResume(resume: PhotoResume): Uint8Array {
  return encodeJson(resume);
}

export function decodeResume(payload: Uint8Array): PhotoResume {
  const v = decodeJson(payload) as Record<string, unknown>;
  if (
    typeof v?.photoId !== 'string' ||
    typeof v.nextIndex !== 'number' ||
    !Number.isInteger(v.nextIndex) ||
    v.nextIndex < 0
  ) {
    throw new PhotoProtocolError('malformed photo RESUME');
  }
  return {photoId: v.photoId, nextIndex: v.nextIndex};
}

export function encodeAck(ack: PhotoAck): Uint8Array {
  return encodeJson(ack);
}

export function decodeAck(payload: Uint8Array): PhotoAck {
  const v = decodeJson(payload) as Record<string, unknown>;
  if (typeof v?.photoId !== 'string' || typeof v.ok !== 'boolean') {
    throw new PhotoProtocolError('malformed photo ACK');
  }
  const ack: PhotoAck = {photoId: v.photoId, ok: v.ok};
  if (typeof v.reason === 'string') ack.reason = v.reason;
  return ack;
}

// ─── CHUNK ───────────────────────────────────────────────────────────────────

export interface PhotoChunk {
  photoId: string;
  index: number;
  data: Uint8Array;
}

/** [idLen:1][id][index:4 BE][data] */
export function encodeChunk(chunk: PhotoChunk): Uint8Array {
  const id = new TextEncoder().encode(chunk.photoId);
  if (id.length === 0 || id.length > MAX_ID_BYTES) {
    throw new PhotoProtocolError('photo id must be 1-255 bytes');
  }

  const out = new Uint8Array(1 + id.length + 4 + chunk.data.length);
  out[0] = id.length;
  out.set(id, 1);
  new DataView(out.buffer).setUint32(1 + id.length, chunk.index, false);
  out.set(chunk.data, 1 + id.length + 4);
  return out;
}

export function decodeChunk(payload: Uint8Array): PhotoChunk {
  if (payload.length < 1) {
    throw new PhotoProtocolError('empty photo CHUNK');
  }
  const idLen = payload[0];
  const headerLen = 1 + idLen + 4;
  if (idLen === 0 || payload.length < headerLen) {
    throw new PhotoProtocolError('truncated photo CHUNK header');
  }

  const photoId = new TextDecoder().decode(payload.subarray(1, 1 + idLen));
  const view = new DataView(
    payload.buffer,
    payload.byteOffset + 1 + idLen,
    4,
  );
  return {
    photoId,
    index: view.getUint32(0, false),
    data: payload.slice(headerLen),
  };
}

export function chunkCount(size: number, chunkSize: number): number {
  return Math.ceil(size / chunkSize);
}
