export const Msg = {
  SESSION_KEY: 0x01,
  STATE_VECTOR: 0x02,
  YJS_UPDATE: 0x03,
  PING: 0x04,
  PONG: 0x05,
  PHOTO_META: 0x06,
  PHOTO_CHUNK: 0x07,
  /** Receiver → sender: the chunk index to (re)start from. Drives resume. */
  PHOTO_RESUME: 0x08,
  /** Receiver → sender: the photo is complete and verified, or failed. */
  PHOTO_ACK: 0x09,
} as const;

export function encode(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}

export function decode(bytes: Uint8Array): {
  type: number;
  payload: Uint8Array;
} {
  return { type: bytes[0], payload: bytes.slice(1) };
}
