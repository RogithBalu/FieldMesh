/**
 * Heartbeat — liveness detection for any Transport.
 *
 * A dropped Wi-Fi link does not close a TCP socket. The OS keeps it open until
 * its own keepalive gives up, which can take minutes, so a phone that walks out
 * of hotspot range looks perfectly connected while syncing nothing. Heartbeat
 * makes that failure visible in seconds.
 *
 * It wraps a Transport and presents a Transport, so it composes underneath
 * YjsSync without either layer knowing about the other:
 *
 *   const hb = new Heartbeat(tcpTransport, { onDead });
 *   const sync = new YjsSync(doc, hb);
 *   hb.start();
 *   sync.start();
 *
 * Both layers read the same byte stream through their own FrameReader: YjsSync
 * already ignores PING/PONG, and Heartbeat ignores everything else. That costs
 * one extra reassembly buffer and keeps the transport's single-handler contract
 * intact.
 */

import { Transport, TransportStatus } from './types';
import { frame, FrameReader } from './framing';
import { Msg, encode, decode } from './messages';

export interface HeartbeatOptions {
  /** How often to send a PING. */
  intervalMs?: number;
  /**
   * Consecutive missed PONGs before the link is declared dead. Two means a
   * single dropped packet doesn't tear down a working connection.
   */
  maxMissed?: number;
  /** Called once when the link is declared dead. */
  onDead?: () => void;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_MISSED = 2;

export class Heartbeat implements Transport {
  readonly name: string;

  private readonly inner: Transport;
  private readonly intervalMs: number;
  private readonly maxMissed: number;
  private readonly onDead?: () => void;

  private readonly reader = new FrameReader();
  private downstream: ((bytes: Uint8Array) => void) | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private missed = 0;
  private dead = false;
  private started = false;

  constructor(inner: Transport, options: HeartbeatOptions = {}) {
    this.inner = inner;
    this.name = `${inner.name}+hb`;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxMissed = options.maxMissed ?? DEFAULT_MAX_MISSED;
    this.onDead = options.onDead;
  }

  /** Consecutive pings currently unanswered. */
  get missedCount(): number {
    return this.missed;
  }

  get isDead(): boolean {
    return this.dead;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.dead = false;
    this.missed = 0;

    // Claim the inner transport's single receive slot; downstream layers get
    // their bytes from us instead.
    this.inner.onReceive((bytes) => this._handleReceive(bytes));

    this.timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  send(bytes: Uint8Array): Promise<void> {
    return this.inner.send(bytes);
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.downstream = handler;
  }

  onStatus(
    handler: (status: TransportStatus, detail?: string) => void,
  ): void {
    this.inner.onStatus(handler);
  }

  open(): Promise<void> {
    return this.inner.open();
  }

  close(): Promise<void> {
    this.stop();
    return this.inner.close();
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _tick(): void {
    if (this.dead) {
      return;
    }

    if (this.missed >= this.maxMissed) {
      this._declareDead();
      return;
    }

    // Counted as missed until a PONG arrives; the next tick decides.
    this.missed++;
    this._sendFrame(Msg.PING);
  }

  private _declareDead(): void {
    this.dead = true;
    this.stop();
    this.onDead?.();
  }

  private _handleReceive(bytes: Uint8Array): void {
    // Everything reaches the layer below untouched, including PING/PONG, which
    // it already ignores.
    this.downstream?.(bytes);

    for (const f of this.reader.push(bytes)) {
      const { type } = decode(f);
      if (type === Msg.PING) {
        this._sendFrame(Msg.PONG);
      } else if (type === Msg.PONG) {
        this.missed = 0;
      }
      // Any traffic at all proves the peer is alive, but only a PONG clears the
      // counter: a peer can be sending while its receive path is broken.
    }
  }

  private _sendFrame(type: number): void {
    this.inner
      .send(frame(encode(type)))
      .catch(() => {
        // A failed write means the socket is already gone; the status handler
        // and the missed-pong counter both surface it.
      });
  }
}
