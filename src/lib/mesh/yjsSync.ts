/**
 * YjsSync — syncs a Y.Doc over any Transport (ported from the FieldMesh RN app).
 *
 *   start() → sends our state vector; on the peer's state vector reply with the
 *   diff (and echo our own vector once); apply incoming updates with `this` as
 *   the transaction origin; forward every local/foreign update to the peer.
 *
 * The per-instance origin is the fan-out mechanism: an update applied by the
 * sync on link A has origin A, so the syncs on links B and C (and the cloud
 * provider) see a foreign update and forward it. Yjs updates are idempotent,
 * so loops die out on their own — no TTLs or seen-sets.
 */
import * as Y from 'yjs';
import { FrameReader, Msg, Transport, decode, encode, frame } from './framing';

export class YjsSync {
  private readonly reader = new FrameReader();
  private readonly onReceive: (bytes: Uint8Array) => void;
  private readonly onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  private started = false;
  private receivedSV = false;
  /** Frames that are not sync traffic (e.g. HELLO) go here. */
  onOther: ((type: number, payload: Uint8Array) => void) | null = null;

  constructor(
    private readonly doc: Y.Doc,
    private readonly transport: Transport
  ) {
    this.onReceive = this.handleReceive.bind(this);
    this.onDocUpdate = this.handleDocUpdate.bind(this);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.receivedSV = false;
    this.transport.onReceive(this.onReceive);
    this.doc.on('update', this.onDocUpdate);
    this.sendStateVector();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.off('update', this.onDocUpdate);
    this.transport.onReceive(() => {});
  }

  sendFrame(type: number, payload: Uint8Array): void {
    this.transport.send(frame(encode(type, payload))).catch(() => {});
  }

  private sendStateVector(): void {
    this.sendFrame(Msg.STATE_VECTOR, Y.encodeStateVector(this.doc));
  }

  private handleReceive(bytes: Uint8Array): void {
    for (const f of this.reader.push(bytes)) {
      const { type, payload } = decode(f);
      switch (type) {
        case Msg.STATE_VECTOR: {
          const diff = Y.encodeStateAsUpdate(this.doc, payload);
          if (diff.length > 2) this.sendFrame(Msg.YJS_UPDATE, diff);
          if (!this.receivedSV) {
            this.receivedSV = true;
            this.sendStateVector();
          }
          break;
        }
        case Msg.YJS_UPDATE:
          Y.applyUpdate(this.doc, payload, this);
          break;
        case Msg.PING:
          this.sendFrame(Msg.PONG, new Uint8Array(0));
          break;
        case Msg.PONG:
          break;
        default:
          this.onOther?.(type, payload);
      }
    }
  }

  private handleDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === this) return;
    this.sendFrame(Msg.YJS_UPDATE, update);
  }
}
