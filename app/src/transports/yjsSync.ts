/**
 * YjsSync — syncs a Y.Doc over any Transport implementation.
 *
 * Protocol (uses primitives from framing.ts + messages.ts):
 *
 *   start()
 *     → sends our state-vector as: frame(encode(Msg.STATE_VECTOR, sv))
 *
 *   on receive Msg.STATE_VECTOR (theirSV)
 *     → replies with: frame(encode(Msg.YJS_UPDATE, diffUpdate))
 *     → if first SV from peer, also sends our own SV so peer can reply with
 *       their diff (bidirectional sync handshake)
 *
 *   on receive Msg.YJS_UPDATE (update)
 *     → applyUpdate(doc, update, this)  // uses `this` instance as origin
 *
 *   doc.on('update', (update, origin))
 *     → if origin !== this: send frame(encode(Msg.YJS_UPDATE, update))
 *
 * Echo-guard design (per-instance origin):
 *   Each YjsSync instance uses `this` as the Yjs transaction origin when
 *   applying remote updates. The echo guard skips only updates whose origin
 *   is THIS instance. This is critical for multi-peer hubs: when spoke A's
 *   update is applied by hub-syncA with origin=hub-syncA, the doc.on('update')
 *   fires for hub-syncB and hub-syncC too — they see origin !== themselves
 *   and correctly fan out the update to their respective spokes.
 *
 * Multi-peer design: one YjsSync instance per peer connection. The transport
 * abstraction (send / onReceive) already isolates individual connections; the
 * caller (e.g. the TCP hub) instantiates one YjsSync per spoke and calls start()
 * when the spoke connects, stop() when it disconnects.
 */

import * as Y from 'yjs';
import { Transport } from './types';
import { frame, FrameReader } from './framing';
import { Msg, encode, decode } from './messages';

/**
 * @deprecated Legacy export — no longer used internally.
 * Each YjsSync instance now uses `this` as transaction origin for per-instance
 * echo guarding. Kept for backward compatibility with external code that may
 * reference it for filtering.
 */
export const REMOTE_ORIGIN = Symbol('yjsSync/remote');

export class YjsSync {
  private readonly doc: Y.Doc;
  private readonly transport: Transport;
  private readonly reader = new FrameReader();

  /** Bound references so addEventListener / removeEventListener are symmetric. */
  private readonly _onReceive: (bytes: Uint8Array) => void;
  private readonly _onDocUpdate: (update: Uint8Array, origin: unknown) => void;

  private started = false;

  /**
   * True once we've received at least one STATE_VECTOR from the peer.
   * Used to prevent infinite SV ping-pong: we echo our SV back only on
   * the first incoming SV (to complete the bidirectional handshake).
   */
  private receivedSV = false;

  constructor(doc: Y.Doc, transport: Transport) {
    this.doc = doc;
    this.transport = transport;

    // Pre-bind so the same function reference is used for both add and remove.
    this._onReceive = this._handleReceive.bind(this);
    this._onDocUpdate = this._handleDocUpdate.bind(this);
  }

  /**
   * Wire listeners and send our initial state vector.
   * Safe to call every time a peer connects (TCP hub may call start() per spoke).
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.receivedSV = false;

    // Listen for raw bytes coming from the peer.
    this.transport.onReceive(this._onReceive);

    // Broadcast our own local edits (excluding echoes of our own remote applies).
    this.doc.on('update', this._onDocUpdate);

    // Kick off the sync by advertising our current state vector.
    this._sendStateVector();
  }

  /** Tear down listeners. Call when the peer disconnects or the session ends. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.doc.off('update', this._onDocUpdate);
    // Note: Transport.onReceive registers a handler; we clear it by passing a no-op.
    // Implementations that support multiple handlers will not remove others' handlers.
    this.transport.onReceive(() => {});
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _sendStateVector(): void {
    const sv = Y.encodeStateVector(this.doc);
    this._sendFrame(Msg.STATE_VECTOR, sv);
  }

  private _sendFrame(type: number, payload: Uint8Array): void {
    const msg = encode(type, payload);
    const framed = frame(msg);
    // Fire-and-forget; surface errors to callers via the transport's onStatus.
    this.transport.send(framed).catch(() => {/* transport is responsible for status */});
  }

  private _handleReceive(bytes: Uint8Array): void {
    // Push raw bytes through the length-prefixed frame reassembler.
    const frames = this.reader.push(bytes);
    for (const f of frames) {
      const { type, payload } = decode(f);
      switch (type) {
        case Msg.STATE_VECTOR:
          this._onPeerStateVector(payload);
          break;
        case Msg.YJS_UPDATE:
          this._onPeerUpdate(payload);
          break;
        // All other message types (PING, PONG, SESSION_KEY, etc.) are handled
        // by other layers; silently ignore them here.
      }
    }
  }

  /**
   * Peer sent us their state vector.
   * Reply with the subset of our history they are missing.
   * On the first SV from a peer, also send our own SV back so the peer
   * can compute what we're missing and send it (bidirectional handshake).
   */
  private _onPeerStateVector(theirSV: Uint8Array): void {
    const diff = Y.encodeStateAsUpdate(this.doc, theirSV);
    if (diff.length > 2) {
      this._sendFrame(Msg.YJS_UPDATE, diff);
    }

    // Complete the bidirectional handshake: echo our SV so the peer
    // can send us what we're missing. Only do this once to prevent
    // infinite SV ping-pong.
    if (!this.receivedSV) {
      this.receivedSV = true;
      this._sendStateVector();
    }
  }

  /**
   * Peer sent us a Yjs update.
   * Apply with `this` as origin so our own 'update' listener (and only ours)
   * skips re-broadcasting it. Other YjsSync instances sharing the same doc
   * see a different origin and correctly fan out the update.
   */
  private _onPeerUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, this);
  }

  /**
   * Our local doc changed.
   * Broadcast to the peer unless this very instance applied the update
   * (i.e. it came from our own peer's network data → skip to avoid echo).
   * Updates from OTHER YjsSync instances (other spokes on the same hub)
   * will have a different origin and WILL be forwarded — this is the
   * multi-peer fan-out path.
   */
  private _handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === this) return; // per-instance echo guard
    this._sendFrame(Msg.YJS_UPDATE, update);
  }
}
