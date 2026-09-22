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
      const view = new DataView(
        this.buf.buffer,
        this.buf.byteOffset + offset
      );
      const len = view.getUint32(0, false);
      if (this.buf.length - offset - HEADER < len) break;
      frames.push(this.buf.slice(offset + HEADER, offset + HEADER + len));
      offset += HEADER + len;
    }
    this.buf = this.buf.slice(offset);
    return frames;
  }

  /**
   * Bytes received but not yet part of a complete frame.
   * The TCP hub hands these to the spoke's transport after the session-key
   * handshake, so a partial frame arriving in the same packet isn't lost.
   */
  remaining(): Uint8Array {
    return this.buf.slice();
  }
}
