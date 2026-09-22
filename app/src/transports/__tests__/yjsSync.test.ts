/**
 * Unit tests for YjsSync.
 *
 * Uses two in-memory InMemoryTransport instances wired directly to each other
 * (no real socket). Proves:
 *   1. Two Y.Docs converge after independent local edits on each side.
 *   2. Remote-applied updates do NOT echo back to the peer (no infinite loop).
 *   3. The state-vector handshake on start() brings each peer up to date.
 */

import * as Y from 'yjs';
import { YjsSync, REMOTE_ORIGIN } from '../yjsSync';
import { Transport, TransportStatus } from '../types';

// ─── In-memory Transport pair ─────────────────────────────────────────────────

/**
 * A single-direction channel endpoint.
 * Call `peer.deliver(bytes)` to push bytes into this transport's receive handler.
 */
class InMemoryTransport implements Transport {
  readonly name: string;

  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler: ((status: TransportStatus, detail?: string) => void) | null = null;

  /** Paired transport that receives whatever we send. */
  private _peer: InMemoryTransport | null = null;

  /** All raw frames this transport has sent (for assertion). */
  readonly sent: Uint8Array[] = [];

  /** Count of times send() was called (includes echoed calls if any). */
  sendCount = 0;

  constructor(name: string) {
    this.name = name;
  }

  /** Wire this transport to another so send() delivers to the other's onReceive. */
  pairWith(other: InMemoryTransport): void {
    this._peer = other;
  }

  // Transport interface ───────────────────────────────────────────────

  async send(bytes: Uint8Array): Promise<void> {
    this.sendCount++;
    this.sent.push(bytes);
    // Deliver synchronously to the peer's receive handler.
    if (this._peer?.receiveHandler) {
      this._peer.receiveHandler(bytes);
    }
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }

  onStatus(handler: (status: TransportStatus, detail?: string) => void): void {
    this.statusHandler = handler;
  }

  async open(): Promise<void> {
    this.statusHandler?.('open');
  }

  async close(): Promise<void> {
    this.statusHandler?.('closed');
  }
}

/** Build a directly-wired pair: tA.send → tB.receive, tB.send → tA.receive. */
function makeTransportPair(): [InMemoryTransport, InMemoryTransport] {
  const tA = new InMemoryTransport('A');
  const tB = new InMemoryTransport('B');
  tA.pairWith(tB);
  tB.pairWith(tA);
  return [tA, tB];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDoc(): Y.Doc {
  return new Y.Doc();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('YjsSync', () => {
  // ── 1. Initial state-vector exchange brings peers up to date ───────────────

  it('syncs pre-existing edits on start()', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    // docA has data before sync.
    docA.getMap('fields').set('crop', 'wheat');

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);

    // start() triggers the state-vector handshake.
    syncA.start();
    syncB.start();

    // Because InMemoryTransport is synchronous, by the time start() returns
    // the full SV → UPDATE round-trip has already completed.
    expect(docB.getMap('fields').get('crop')).toBe('wheat');
  });

  // ── 2. Live local edits propagate across the transport ────────────────────

  it('propagates live edits from A to B', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    // Make a live edit on A after sync is running.
    docA.getMap('fields').set('status', 'planted');

    expect(docB.getMap('fields').get('status')).toBe('planted');
  });

  it('propagates live edits from B to A', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    docB.getMap('fields').set('irrigation', 'drip');

    expect(docA.getMap('fields').get('irrigation')).toBe('drip');
  });

  // ── 3. Both sides converge after independent concurrent edits ─────────────

  it('converges two docs after independent edits on both sides', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    // Pre-populate each doc independently before syncing.
    docA.getMap('fields').set('sown_by', 'Athidh');
    docB.getMap('fields').set('approved_by', 'Rogith');

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    // Both docs should have both keys.
    expect(docA.getMap('fields').get('sown_by')).toBe('Athidh');
    expect(docA.getMap('fields').get('approved_by')).toBe('Rogith');
    expect(docB.getMap('fields').get('sown_by')).toBe('Athidh');
    expect(docB.getMap('fields').get('approved_by')).toBe('Rogith');
  });

  // ── 4. Echo guard: remote updates do NOT loop back to the sender ──────────

  it('does not re-broadcast updates that originated from the network', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    // Record send counts after the initial SV handshake settles.
    const sendCountA_before = tA.sendCount;
    const sendCountB_before = tB.sendCount;

    // A makes one edit.
    docA.getMap('data').set('key', 'value');

    // A should have sent exactly 1 more frame (the live YJS_UPDATE).
    expect(tA.sendCount - sendCountA_before).toBe(1);

    // B receives it and applies (REMOTE_ORIGIN), so B must NOT re-send it.
    // B's send count must NOT increase due to the incoming update from A.
    expect(tB.sendCount - sendCountB_before).toBe(0);
  });

  it('does not echo even across multiple round-trips', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    const before = { a: tA.sendCount, b: tB.sendCount };

    // Multiple edits on each side.
    docA.getMap('m').set('a1', 1);
    docA.getMap('m').set('a2', 2);
    docB.getMap('m').set('b1', 3);
    docB.getMap('m').set('b2', 4);

    // Each local edit triggers exactly one send; no extra sends from echoing.
    expect(tA.sendCount - before.a).toBe(2); // a1, a2
    expect(tB.sendCount - before.b).toBe(2); // b1, b2

    // Docs fully converged.
    const mapA = docA.getMap('m').toJSON();
    const mapB = docB.getMap('m').toJSON();
    expect(mapA).toEqual({ a1: 1, a2: 2, b1: 3, b2: 4 });
    expect(mapB).toEqual(mapA);
  });

  // ── 5. stop() prevents further relay of local edits ───────────────────────

  it('stop() detaches the doc update listener', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    syncA.stop();

    const before = tA.sendCount;

    // Edit on docA after stop — should NOT be sent.
    docA.getMap('x').set('key', 'after-stop');

    expect(tA.sendCount).toBe(before);
    // docB should not have received the post-stop edit.
    expect(docB.getMap('x').get('key')).toBeUndefined();
  });

  // ── 6. REMOTE_ORIGIN symbol is exported and distinct from primitives ───────

  it('REMOTE_ORIGIN is still exported as a symbol (deprecated, for backward compat)', () => {
    // REMOTE_ORIGIN is no longer used internally (each instance uses `this`),
    // but it's still exported for external code that may reference it.
    expect(typeof REMOTE_ORIGIN).toBe('symbol');
    expect(REMOTE_ORIGIN).not.toBe(Symbol('yjsSync/remote')); // each Symbol() is unique
    expect(REMOTE_ORIGIN.toString()).toBe('Symbol(yjsSync/remote)');
  });

  // ── 7. start() is idempotent ───────────────────────────────────────────────

  it('calling start() twice does not double-wire listeners', () => {
    const [tA, tB] = makeTransportPair();
    const docA = makeDoc();
    const docB = makeDoc();

    const syncA = new YjsSync(docA, tA);
    const syncB = new YjsSync(docB, tB);
    syncA.start();
    syncB.start();

    // Second start() should be a no-op.
    syncA.start();
    syncB.start();

    const before = tA.sendCount;

    docA.getMap('idem').set('x', 1);

    // Still exactly 1 send, not 2.
    expect(tA.sendCount - before).toBe(1);
    expect(docB.getMap('idem').get('x')).toBe(1);
  });
});
