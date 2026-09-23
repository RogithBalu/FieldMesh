/** Length-prefixed frames over a byte stream (ported from the FieldMesh RN app). */
const HEADER = 4;

export function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, HEADER);
  return out;
}

export class FrameReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const frames: Uint8Array[] = [];
    let offset = 0;
    while (this.buf.length - offset >= HEADER) {
      const view = new DataView(this.buf.buffer, this.buf.byteOffset + offset);
      const len = view.getUint32(0, false);
      if (this.buf.length - offset - HEADER < len) break;
      frames.push(this.buf.slice(offset + HEADER, offset + HEADER + len));
      offset += HEADER + len;
    }
    this.buf = this.buf.slice(offset);
    return frames;
  }

  /** Bytes received but not yet part of a complete frame (replayed after a handshake). */
  remaining(): Uint8Array {
    return this.buf.slice();
  }
}

export const Msg = {
  SESSION_KEY: 0x01,
  STATE_VECTOR: 0x02,
  YJS_UPDATE: 0x03,
  PING: 0x04,
  PONG: 0x05,
  /** Identity of the peer (JSON): sent once right after a link opens. */
  HELLO: 0x10,
  /**
   * Admission to a hosted session, relayed hop by hop (JSON). A phone out of
   * QR range of the host asks over the mesh instead; the host answers, and the
   * grant carries the session credentials back along the same path.
   */
  JOIN_REQUEST: 0x20,
  JOIN_DECISION: 0x21,
} as const;

export function encode(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}

export function decode(bytes: Uint8Array): { type: number; payload: Uint8Array } {
  return { type: bytes[0], payload: bytes.slice(1) };
}

export interface Transport {
  readonly name: string;
  send(bytes: Uint8Array): Promise<void>;
  onReceive(handler: (bytes: Uint8Array) => void): void;
  onStatus(handler: (status: 'open' | 'closed' | 'error', detail?: string) => void): void;
  close(): Promise<void>;
}
