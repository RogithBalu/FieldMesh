/**
 * Sending and receiving photos over any Transport, with resume.
 *
 * Like Heartbeat, this wraps a Transport and presents one, so it composes with
 * YjsSync on the same connection: photo frames are handled here, everything
 * else passes through untouched.
 *
 *   const photos = new PhotoTransfer(transport, { store });
 *   const sync = new YjsSync(doc, photos);
 *
 * Resume is receiver-driven. The sender announces the photo and waits to be
 * told where to start, so a transfer interrupted at 80% resumes at 80% even
 * though the sender has no memory of the earlier attempt — which matters
 * because the sender is usually the side that walked out of range.
 */

import {Transport, TransportStatus} from '../transports/types';
import {frame, FrameReader} from '../transports/framing';
import {Msg, encode, decode} from '../transports/messages';
import {
  PhotoMeta,
  chunkCount,
  decodeAck,
  decodeChunk,
  decodeMeta,
  decodeResume,
  encodeAck,
  encodeChunk,
  encodeMeta,
  encodeResume,
} from './protocol';

/**
 * Where partially received photos live between chunks.
 *
 * In the app this is backed by the filesystem so a resume survives the app
 * being killed; in tests it is in memory. Either way the receiver only needs
 * to know how much of a photo it already holds.
 */
export interface PartialPhotoStore {
  /** Chunks already stored for this photo, as a count from index 0. */
  received(photoId: string): number;
  put(photoId: string, index: number, data: Uint8Array): void;
  /** Assembled bytes, once every chunk has arrived. */
  assemble(photoId: string): Uint8Array;
  discard(photoId: string): void;
}

/** Default in-memory store; fine for a session, lost if the app dies. */
export class MemoryPhotoStore implements PartialPhotoStore {
  private chunks = new Map<string, Map<number, Uint8Array>>();

  received(photoId: string): number {
    const m = this.chunks.get(photoId);
    if (!m) return 0;
    // Contiguous run from 0 — a gap means we must resume at the gap, not past it.
    let n = 0;
    while (m.has(n)) n++;
    return n;
  }

  put(photoId: string, index: number, data: Uint8Array): void {
    let m = this.chunks.get(photoId);
    if (!m) {
      m = new Map();
      this.chunks.set(photoId, m);
    }
    m.set(index, data);
  }

  assemble(photoId: string): Uint8Array {
    const m = this.chunks.get(photoId);
    if (!m) return new Uint8Array(0);
    const ordered = [...m.entries()].sort((a, b) => a[0] - b[0]);
    const total = ordered.reduce((n, [, d]) => n + d.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const [, d] of ordered) {
      out.set(d, off);
      off += d.length;
    }
    return out;
  }

  discard(photoId: string): void {
    this.chunks.delete(photoId);
  }
}

export interface ReceivedPhoto {
  meta: PhotoMeta;
  data: Uint8Array;
  /** Undefined when the sender sent no hash or no hashFn was supplied. */
  verified?: boolean;
}

export interface PhotoTransferOptions {
  store?: PartialPhotoStore;
  /** Computes lowercase hex SHA-256; omit to skip verification. */
  hashFn?: (data: Uint8Array) => string;
  onReceived?: (photo: ReceivedPhoto) => void;
  onProgress?: (photoId: string, sent: number, total: number) => void;
}

const DEFAULT_CHUNK_SIZE = 16 * 1024;

export class PhotoTransfer implements Transport {
  readonly name: string;

  private readonly inner: Transport;
  private readonly store: PartialPhotoStore;
  private readonly hashFn?: (data: Uint8Array) => string;
  private readonly onReceived?: (photo: ReceivedPhoto) => void;
  private readonly onProgress?: (
    photoId: string,
    sent: number,
    total: number,
  ) => void;

  private readonly reader = new FrameReader();
  private downstream: ((bytes: Uint8Array) => void) | null = null;

  /** Photos this side is sending, awaiting RESUME or ACK. */
  private outgoing = new Map<
    string,
    {
      meta: PhotoMeta;
      data: Uint8Array;
      resolve: () => void;
      reject: (e: Error) => void;
    }
  >();

  /** META received, so chunks for these are expected. */
  private incoming = new Map<string, PhotoMeta>();

  constructor(inner: Transport, options: PhotoTransferOptions = {}) {
    this.inner = inner;
    this.name = `${inner.name}+photo`;
    this.store = options.store ?? new MemoryPhotoStore();
    this.hashFn = options.hashFn;
    this.onReceived = options.onReceived;
    this.onProgress = options.onProgress;

    this.inner.onReceive((bytes) => this._handleReceive(bytes));
  }

  /**
   * Send a photo, resolving once the receiver acknowledges it.
   * Rejects if the receiver reports a failed verification.
   */
  sendPhoto(
    photoId: string,
    data: Uint8Array,
    options: {chunkSize?: number; sha256?: string; name?: string} = {},
  ): Promise<void> {
    const meta: PhotoMeta = {
      photoId,
      size: data.length,
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    };
    if (options.sha256) meta.sha256 = options.sha256;
    if (options.name) meta.name = options.name;

    return new Promise<void>((resolve, reject) => {
      this.outgoing.set(photoId, {meta, data, resolve, reject});
      this._send(Msg.PHOTO_META, encodeMeta(meta));
    });
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  send(bytes: Uint8Array): Promise<void> {
    return this.inner.send(bytes);
  }
  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.downstream = handler;
  }
  onStatus(h: (status: TransportStatus, detail?: string) => void): void {
    this.inner.onStatus(h);
  }
  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _send(type: number, payload: Uint8Array): void {
    this.inner.send(frame(encode(type, payload))).catch(() => {
      // Transport status reports the failure; a half-sent photo resumes on the
      // next attempt rather than erroring here.
    });
  }

  private _handleReceive(bytes: Uint8Array): void {
    this.downstream?.(bytes);

    for (const f of this.reader.push(bytes)) {
      const {type, payload} = decode(f);
      switch (type) {
        case Msg.PHOTO_META:
          this._onMeta(payload);
          break;
        case Msg.PHOTO_RESUME:
          this._onResume(payload);
          break;
        case Msg.PHOTO_CHUNK:
          this._onChunk(payload);
          break;
        case Msg.PHOTO_ACK:
          this._onAck(payload);
          break;
      }
    }
  }

  private _onMeta(payload: Uint8Array): void {
    const meta = decodeMeta(payload);
    this.incoming.set(meta.photoId, meta);
    // Tell the sender where we actually are, which may be mid-file.
    this._send(
      Msg.PHOTO_RESUME,
      encodeResume({
        photoId: meta.photoId,
        nextIndex: this.store.received(meta.photoId),
      }),
    );
  }

  private _onResume(payload: Uint8Array): void {
    const {photoId, nextIndex} = decodeResume(payload);
    const out = this.outgoing.get(photoId);
    if (!out) {
      return;
    }

    const total = chunkCount(out.meta.size, out.meta.chunkSize);
    for (let i = nextIndex; i < total; i++) {
      const start = i * out.meta.chunkSize;
      const slice = out.data.subarray(
        start,
        Math.min(start + out.meta.chunkSize, out.data.length),
      );
      this._send(Msg.PHOTO_CHUNK, encodeChunk({photoId, index: i, data: slice}));
      this.onProgress?.(photoId, i + 1, total);
    }
  }

  private _onChunk(payload: Uint8Array): void {
    const {photoId, index, data} = decodeChunk(payload);
    const meta = this.incoming.get(photoId);
    if (!meta) {
      // A chunk with no META is unusable — we don't know the size or hash.
      return;
    }

    this.store.put(photoId, index, data);

    const total = chunkCount(meta.size, meta.chunkSize);
    if (this.store.received(photoId) < total) {
      return;
    }

    const assembled = this.store.assemble(photoId);
    let verified: boolean | undefined;
    if (meta.sha256 && this.hashFn) {
      verified = this.hashFn(assembled) === meta.sha256.toLowerCase();
    }

    if (verified === false) {
      // Drop it: a corrupt photo must not be resumable from a poisoned cache.
      this.store.discard(photoId);
      this.incoming.delete(photoId);
      this._send(
        Msg.PHOTO_ACK,
        encodeAck({photoId, ok: false, reason: 'sha256 mismatch'}),
      );
      return;
    }

    this.incoming.delete(photoId);
    this.store.discard(photoId);
    this._send(Msg.PHOTO_ACK, encodeAck({photoId, ok: true}));
    this.onReceived?.({meta, data: assembled, verified});
  }

  private _onAck(payload: Uint8Array): void {
    const ack = decodeAck(payload);
    const out = this.outgoing.get(ack.photoId);
    if (!out) {
      return;
    }
    this.outgoing.delete(ack.photoId);
    if (ack.ok) {
      out.resolve();
    } else {
      out.reject(
        new Error(`receiver rejected photo: ${ack.reason ?? 'unknown'}`),
      );
    }
  }
}
