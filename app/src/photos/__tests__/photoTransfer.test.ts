import * as Y from 'yjs';
import {
  PhotoTransfer,
  MemoryPhotoStore,
  ReceivedPhoto,
} from '../photoTransfer';
import {
  decodeChunk,
  decodeMeta,
  encodeChunk,
  decodeResume,
  chunkCount,
  PhotoProtocolError,
} from '../protocol';
import {Transport, TransportStatus} from '../../transports/types';
import {FrameReader} from '../../transports/framing';
import {Msg, decode} from '../../transports/messages';
import {YjsSync} from '../../transports/yjsSync';

class Pipe implements Transport {
  readonly name = 'pipe';
  private receiveHandler: ((b: Uint8Array) => void) | null = null;
  private statusHandler: ((s: TransportStatus, d?: string) => void) | null =
    null;
  peer: Pipe | null = null;

  /** Stop delivering, to simulate the link dropping mid-transfer. */
  severed = false;
  readonly sent: Uint8Array[] = [];

  async send(bytes: Uint8Array): Promise<void> {
    this.sent.push(bytes);
    if (this.severed) return;
    this.peer?.receiveHandler?.(bytes);
  }
  onReceive(h: (b: Uint8Array) => void): void {
    this.receiveHandler = h;
  }
  onStatus(h: (s: TransportStatus, d?: string) => void): void {
    this.statusHandler = h;
  }
  async open(): Promise<void> {
    this.statusHandler?.('open');
  }
  async close(): Promise<void> {
    this.statusHandler?.('closed');
  }

  /** Message types written by this side, in order. */
  types(): number[] {
    const r = new FrameReader();
    const out: number[] = [];
    for (const c of this.sent) {
      for (const f of r.push(c)) out.push(decode(f).type);
    }
    return out;
  }

  /** Decoded chunk indices this side wrote. */
  chunkIndices(): number[] {
    const r = new FrameReader();
    const out: number[] = [];
    for (const c of this.sent) {
      for (const f of r.push(c)) {
        const {type, payload} = decode(f);
        if (type === Msg.PHOTO_CHUNK) out.push(decodeChunk(payload).index);
      }
    }
    return out;
  }
}

function makePipe(): [Pipe, Pipe] {
  const a = new Pipe();
  const b = new Pipe();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

function photoBytes(n: number): Uint8Array {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = i % 251;
  return d;
}

/** Trivial deterministic stand-in for SHA-256; the protocol only compares strings. */
function fakeHash(data: Uint8Array): string {
  let h = 2166136261;
  for (const b of data) {
    h = ((h ^ b) * 16777619) >>> 0;
  }
  return h.toString(16);
}

describe('photo protocol', () => {
  it('round-trips a chunk including its index and bytes', () => {
    const data = photoBytes(300);
    const encoded = encodeChunk({photoId: 'p1', index: 7, data});
    const back = decodeChunk(encoded);

    expect(back.photoId).toBe('p1');
    expect(back.index).toBe(7);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });

  it('handles a large chunk index without truncation', () => {
    const back = decodeChunk(
      encodeChunk({photoId: 'p', index: 70000, data: new Uint8Array(1)}),
    );
    expect(back.index).toBe(70000);
  });

  it('rejects a truncated chunk header rather than reading past it', () => {
    expect(() => decodeChunk(new Uint8Array([5, 1, 2]))).toThrow(
      PhotoProtocolError,
    );
  });

  it('rejects malformed META', () => {
    const bad = new TextEncoder().encode(JSON.stringify({photoId: 'p'}));
    expect(() => decodeMeta(bad)).toThrow(PhotoProtocolError);
  });

  it('rejects a negative resume index', () => {
    const bad = new TextEncoder().encode(
      JSON.stringify({photoId: 'p', nextIndex: -1}),
    );
    expect(() => decodeResume(bad)).toThrow(PhotoProtocolError);
  });

  it('counts chunks with a partial final chunk', () => {
    expect(chunkCount(100, 30)).toBe(4);
    expect(chunkCount(90, 30)).toBe(3);
    expect(chunkCount(0, 30)).toBe(0);
  });
});

describe('PhotoTransfer', () => {
  it('transfers a photo and resolves once acknowledged', async () => {
    const [a, b] = makePipe();
    const received: ReceivedPhoto[] = [];

    new PhotoTransfer(b, {onReceived: (p) => received.push(p)});
    const sender = new PhotoTransfer(a);

    const data = photoBytes(5000);
    await sender.sendPhoto('p1', data, {chunkSize: 1000});

    expect(received).toHaveLength(1);
    expect(Array.from(received[0].data)).toEqual(Array.from(data));
    expect(received[0].meta.size).toBe(5000);
  });

  it('sends a final partial chunk intact', async () => {
    const [a, b] = makePipe();
    const received: ReceivedPhoto[] = [];
    new PhotoTransfer(b, {onReceived: (p) => received.push(p)});
    const sender = new PhotoTransfer(a);

    const data = photoBytes(2500); // 2 full chunks + 500 bytes
    await sender.sendPhoto('p1', data, {chunkSize: 1000});

    expect(received[0].data.length).toBe(2500);
    expect(Array.from(received[0].data)).toEqual(Array.from(data));
  });

  it('reports progress across all chunks', async () => {
    const [a, b] = makePipe();
    new PhotoTransfer(b);
    const progress: number[] = [];
    const sender = new PhotoTransfer(a, {
      onProgress: (_id, sent) => progress.push(sent),
    });

    await sender.sendPhoto('p1', photoBytes(3000), {chunkSize: 1000});

    expect(progress).toEqual([1, 2, 3]);
  });

  it('verifies the hash and reports it as verified', async () => {
    const [a, b] = makePipe();
    const received: ReceivedPhoto[] = [];
    new PhotoTransfer(b, {
      hashFn: fakeHash,
      onReceived: (p) => received.push(p),
    });
    const sender = new PhotoTransfer(a);

    const data = photoBytes(2000);
    await sender.sendPhoto('p1', data, {
      chunkSize: 500,
      sha256: fakeHash(data),
    });

    expect(received[0].verified).toBe(true);
  });

  it('rejects the send when the hash does not match', async () => {
    const [a, b] = makePipe();
    const received: ReceivedPhoto[] = [];
    new PhotoTransfer(b, {
      hashFn: fakeHash,
      onReceived: (p) => received.push(p),
    });
    const sender = new PhotoTransfer(a);

    await expect(
      sender.sendPhoto('p1', photoBytes(1000), {
        chunkSize: 500,
        sha256: 'deadbeef',
      }),
    ).rejects.toThrow(/sha256 mismatch/);

    // A corrupt photo must not be surfaced to the app.
    expect(received).toHaveLength(0);
  });

  // ── Resume, the reason this is chunked at all ─────────────────────────────

  it('resumes from where the receiver got to, not from zero', async () => {
    const [a1, b1] = makePipe();
    const store = new MemoryPhotoStore();
    new PhotoTransfer(b1, {store});
    const sender1 = new PhotoTransfer(a1);

    const data = photoBytes(10000); // 10 chunks of 1000
    // Drop the link after META/RESUME have been exchanged.
    a1.severed = true;
    sender1.sendPhoto('p1', data, {chunkSize: 1000});

    // Feed the receiver only the first 4 chunks, as if the link died there.
    const partial = new PhotoTransfer(b1, {store});
    for (let i = 0; i < 4; i++) {
      store.put('p1', i, data.subarray(i * 1000, (i + 1) * 1000));
    }
    expect(store.received('p1')).toBe(4);
    void partial;

    // Reconnect: fresh transports, same receiver store, fresh sender.
    const [a2, b2] = makePipe();
    const received: ReceivedPhoto[] = [];
    new PhotoTransfer(b2, {store, onReceived: (p) => received.push(p)});
    const sender2 = new PhotoTransfer(a2);

    await sender2.sendPhoto('p1', data, {chunkSize: 1000});

    // The sender skipped the four chunks already held.
    expect(a2.chunkIndices()).toEqual([4, 5, 6, 7, 8, 9]);
    expect(Array.from(received[0].data)).toEqual(Array.from(data));
  });

  it('asks for index 0 when it has nothing', async () => {
    const [a, b] = makePipe();
    new PhotoTransfer(b);
    const sender = new PhotoTransfer(a);

    await sender.sendPhoto('p1', photoBytes(2000), {chunkSize: 1000});

    expect(b.types()).toContain(Msg.PHOTO_RESUME);
    expect(a.chunkIndices()).toEqual([0, 1]);
  });

  it('resumes at a gap rather than past it', () => {
    const store = new MemoryPhotoStore();
    store.put('p1', 0, new Uint8Array(10));
    store.put('p1', 1, new Uint8Array(10));
    // Chunk 2 never arrived, but 3 did.
    store.put('p1', 3, new Uint8Array(10));

    // Resuming at 4 would leave a hole in the file.
    expect(store.received('p1')).toBe(2);
  });

  it('ignores chunks for a photo it has no META for', () => {
    const [, b] = makePipe();
    const received: ReceivedPhoto[] = [];
    const receiver = new PhotoTransfer(b, {onReceived: (p) => received.push(p)});

    // Should not throw, and nothing completes.
    expect(() =>
      receiver['_onChunk'](
        encodeChunk({photoId: 'ghost', index: 0, data: new Uint8Array(4)}),
      ),
    ).not.toThrow();
    expect(received).toHaveLength(0);
  });
});

describe('PhotoTransfer composed with YjsSync', () => {
  it('carries photos and document sync on one connection', async () => {
    const [a, b] = makePipe();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const received: ReceivedPhoto[] = [];

    const photosA = new PhotoTransfer(a);
    const photosB = new PhotoTransfer(b, {onReceived: (p) => received.push(p)});
    new YjsSync(docA, photosA).start();
    new YjsSync(docB, photosB).start();

    docA.getMap('fields').set('crop', 'wheat');
    await photosA.sendPhoto('p1', photoBytes(3000), {chunkSize: 1000});
    docA.getMap('fields').set('soil', 'clay');

    // Photo frames must not corrupt the document stream, or vice versa.
    expect(received).toHaveLength(1);
    expect(docB.getMap('fields').toJSON()).toEqual({
      crop: 'wheat',
      soil: 'clay',
    });
  });
});
