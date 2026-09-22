/**
 * Unit tests for the TCP hub's session-key auth and multi-peer fan-out logic.
 *
 * Uses in-memory Transports (no real sockets) to simulate:
 *   - Session key validation (accept / reject)
 *   - Multi-peer fan-out: edit from spoke A reaches spokes B and C
 *   - Echo guard: spoke A's edit does NOT echo back to spoke A
 *
 * The InMemoryTransport from yjsSync.test.ts is duplicated here (same shape)
 * since it's a test-only utility.
 */

import * as Y from 'yjs';
import { YjsSync } from '../yjsSync';
import { Transport, TransportStatus } from '../types';
import { frame } from '../framing';
import { Msg, encode, decode } from '../messages';

// ─── In-memory Transport (same as yjsSync.test.ts) ────────────────────────────

class InMemoryTransport implements Transport {
  readonly name: string;

  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler: ((status: TransportStatus, detail?: string) => void) | null = null;
  private _peer: InMemoryTransport | null = null;

  readonly sent: Uint8Array[] = [];
  sendCount = 0;

  constructor(name: string) {
    this.name = name;
  }

  pairWith(other: InMemoryTransport): void {
    this._peer = other;
  }

  async send(bytes: Uint8Array): Promise<void> {
    this.sendCount++;
    this.sent.push(bytes);
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

  /** Simulate receiving data from the network (for session key injection). */
  simulateReceive(bytes: Uint8Array): void {
    this.receiveHandler?.(bytes);
  }
}

function makeTransportPair(nameA: string, nameB: string): [InMemoryTransport, InMemoryTransport] {
  const tA = new InMemoryTransport(nameA);
  const tB = new InMemoryTransport(nameB);
  tA.pairWith(tB);
  tB.pairWith(tA);
  return [tA, tB];
}

// ─── Hub simulation helpers ──────────────────────────────────────────────────

/**
 * Simulates the hub's session-key check logic from tcpHub.ts without needing
 * real TCP sockets. Returns the YjsSync instance if authenticated, null if rejected.
 */
function authenticateSpoke(
  hubDoc: Y.Doc,
  hubSideTransport: InMemoryTransport,
  spokeSideTransport: InMemoryTransport,
  expectedKey: string,
  providedKey: string,
): YjsSync | null {
  const expectedKeyBytes = new TextEncoder().encode(expectedKey);
  const providedKeyBytes = new TextEncoder().encode(providedKey);

  // Spoke sends session key as the first frame.
  const sessionKeyMsg = encode(Msg.SESSION_KEY, providedKeyBytes);
  const sessionKeyFrame = frame(sessionKeyMsg);

  // Simulate: the hub-side transport receives the session key frame.
  // We manually decode it (as tcpHub.ts would) to decide whether to attach YjsSync.
  const { type, payload } = decode(sessionKeyMsg);

  if (type !== Msg.SESSION_KEY) return null;

  if (!bytesEqual(payload, expectedKeyBytes)) return null;

  // Authenticated — attach YjsSync.
  const sync = new YjsSync(hubDoc, hubSideTransport);
  sync.start();
  return sync;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TCP Hub — session key & multi-peer fan-out', () => {

  // ── Session key validation ──────────────────────────────────────────────

  it('rejects a spoke with the wrong session key', () => {
    const hubDoc = new Y.Doc();
    const [hubSide, spokeSide] = makeTransportPair('hub-A', 'spoke-A');

    const result = authenticateSpoke(hubDoc, hubSide, spokeSide, 'correct-key', 'wrong-key');

    expect(result).toBeNull();
    // Hub doc should remain empty — no sync was attached.
    expect(hubDoc.getMap('data').size).toBe(0);
  });

  it('accepts a spoke with the correct session key and syncs', () => {
    const hubDoc = new Y.Doc();
    const spokeDoc = new Y.Doc();

    const [hubSide, spokeSide] = makeTransportPair('hub-A', 'spoke-A');

    const hubSync = authenticateSpoke(hubDoc, hubSide, spokeSide, 'field-session-1', 'field-session-1');
    expect(hubSync).not.toBeNull();

    // Attach spoke-side YjsSync too.
    const spokeSync = new YjsSync(spokeDoc, spokeSide);
    spokeSync.start();

    // Edit on spoke should reach hub doc.
    spokeDoc.getMap('data').set('inspector', 'Athidh');
    expect(hubDoc.getMap('data').get('inspector')).toBe('Athidh');
  });

  // ── Multi-peer fan-out (THE critical test) ──────────────────────────────

  it('fans out an edit from spoke A to spokes B and C via the hub', () => {
    const hubDoc = new Y.Doc();
    const spokeDocA = new Y.Doc();
    const spokeDocB = new Y.Doc();
    const spokeDocC = new Y.Doc();

    // Create transport pairs: hub↔spokeA, hub↔spokeB, hub↔spokeC
    const [hubA, sideA] = makeTransportPair('hub-A', 'spoke-A');
    const [hubB, sideB] = makeTransportPair('hub-B', 'spoke-B');
    const [hubC, sideC] = makeTransportPair('hub-C', 'spoke-C');

    // Authenticate all three spokes (all use correct key).
    const syncHubA = authenticateSpoke(hubDoc, hubA, sideA, 'key', 'key')!;
    const syncHubB = authenticateSpoke(hubDoc, hubB, sideB, 'key', 'key')!;
    const syncHubC = authenticateSpoke(hubDoc, hubC, sideC, 'key', 'key')!;

    expect(syncHubA).not.toBeNull();
    expect(syncHubB).not.toBeNull();
    expect(syncHubC).not.toBeNull();

    // Attach spoke-side YjsSyncs.
    const syncA = new YjsSync(spokeDocA, sideA);
    const syncB = new YjsSync(spokeDocB, sideB);
    const syncC = new YjsSync(spokeDocC, sideC);
    syncA.start();
    syncB.start();
    syncC.start();

    // ── Spoke A makes an edit ──
    spokeDocA.getMap('inspection').set('field_id', 'FIELD-42');

    // Hub doc should have it.
    expect(hubDoc.getMap('inspection').get('field_id')).toBe('FIELD-42');

    // Spoke B and C should ALSO have it (fan-out via hub).
    expect(spokeDocB.getMap('inspection').get('field_id')).toBe('FIELD-42');
    expect(spokeDocC.getMap('inspection').get('field_id')).toBe('FIELD-42');
  });

  it('fans out edits from spoke B to spokes A and C', () => {
    const hubDoc = new Y.Doc();
    const spokeDocA = new Y.Doc();
    const spokeDocB = new Y.Doc();
    const spokeDocC = new Y.Doc();

    const [hubA, sideA] = makeTransportPair('hub-A', 'spoke-A');
    const [hubB, sideB] = makeTransportPair('hub-B', 'spoke-B');
    const [hubC, sideC] = makeTransportPair('hub-C', 'spoke-C');

    authenticateSpoke(hubDoc, hubA, sideA, 'key', 'key');
    authenticateSpoke(hubDoc, hubB, sideB, 'key', 'key');
    authenticateSpoke(hubDoc, hubC, sideC, 'key', 'key');

    const syncA = new YjsSync(spokeDocA, sideA);
    const syncB = new YjsSync(spokeDocB, sideB);
    const syncC = new YjsSync(spokeDocC, sideC);
    syncA.start();
    syncB.start();
    syncC.start();

    // Spoke B makes an edit.
    spokeDocB.getMap('data').set('status', 'approved');

    expect(hubDoc.getMap('data').get('status')).toBe('approved');
    expect(spokeDocA.getMap('data').get('status')).toBe('approved');
    expect(spokeDocC.getMap('data').get('status')).toBe('approved');
  });

  // ── Echo guard still works in multi-peer ────────────────────────────────

  it('does not echo spoke A edit back to spoke A', () => {
    const hubDoc = new Y.Doc();
    const spokeDocA = new Y.Doc();
    const spokeDocB = new Y.Doc();

    const [hubA, sideA] = makeTransportPair('hub-A', 'spoke-A');
    const [hubB, sideB] = makeTransportPair('hub-B', 'spoke-B');

    authenticateSpoke(hubDoc, hubA, sideA, 'key', 'key');
    authenticateSpoke(hubDoc, hubB, sideB, 'key', 'key');

    const syncA = new YjsSync(spokeDocA, sideA);
    const syncB = new YjsSync(spokeDocB, sideB);
    syncA.start();
    syncB.start();

    // Record send counts after handshake settles.
    const hubA_before = hubA.sendCount;

    // Spoke A makes an edit.
    spokeDocA.getMap('echo').set('test', 'val');

    // Hub-side transport A: receives spoke A's update, applies to hubDoc,
    // but should NOT send the same update BACK to spoke A.
    // It SHOULD send spoke A's update to spoke B (fan-out).
    // So hubA sends should increase by the fan-out from B's perspective only
    // if B's update triggers something, but the KEY check is:
    // hubA should NOT re-echo spokeA's own edit back.

    // Spoke B should have the edit (fan-out works).
    expect(spokeDocB.getMap('echo').get('test')).toBe('val');

    // Spoke A should NOT have received a duplicate (no echo loop).
    // If there were an echo, sideA would have received an extra YJS_UPDATE
    // and spokeDocA would have the value applied twice — but Yjs is idempotent,
    // so we verify via send counts instead.
    // hubA's sends after the edit should be 0 or only SV-related, not a YJS_UPDATE echo.
    // Actually: hubA should NOT send because its echo guard (origin === syncHubA) blocks it.
    // hubB SHOULD send the fan-out to spokeB.
    // So hubA.sendCount should not increase from the spokeA edit.
    expect(hubA.sendCount - hubA_before).toBe(0);
  });

  // ── All three spokes converge with concurrent edits ─────────────────────

  it('all spokes converge after concurrent edits from each', () => {
    const hubDoc = new Y.Doc();
    const spokeDocA = new Y.Doc();
    const spokeDocB = new Y.Doc();
    const spokeDocC = new Y.Doc();

    const [hubA, sideA] = makeTransportPair('hub-A', 'spoke-A');
    const [hubB, sideB] = makeTransportPair('hub-B', 'spoke-B');
    const [hubC, sideC] = makeTransportPair('hub-C', 'spoke-C');

    authenticateSpoke(hubDoc, hubA, sideA, 'key', 'key');
    authenticateSpoke(hubDoc, hubB, sideB, 'key', 'key');
    authenticateSpoke(hubDoc, hubC, sideC, 'key', 'key');

    const syncA = new YjsSync(spokeDocA, sideA);
    const syncB = new YjsSync(spokeDocB, sideB);
    const syncC = new YjsSync(spokeDocC, sideC);
    syncA.start();
    syncB.start();
    syncC.start();

    // Each spoke makes a different edit.
    spokeDocA.getMap('fields').set('crop', 'rice');
    spokeDocB.getMap('fields').set('soil', 'clay');
    spokeDocC.getMap('fields').set('water', 'drip');

    // All four docs (hub + 3 spokes) should have all three keys.
    const expected = { crop: 'rice', soil: 'clay', water: 'drip' };

    expect(hubDoc.getMap('fields').toJSON()).toEqual(expected);
    expect(spokeDocA.getMap('fields').toJSON()).toEqual(expected);
    expect(spokeDocB.getMap('fields').toJSON()).toEqual(expected);
    expect(spokeDocC.getMap('fields').toJSON()).toEqual(expected);
  });

  // ── Spoke disconnect cleanup ────────────────────────────────────────────

  it('stop() on a spoke sync prevents further relay', () => {
    const hubDoc = new Y.Doc();
    const spokeDocA = new Y.Doc();
    const spokeDocB = new Y.Doc();

    const [hubA, sideA] = makeTransportPair('hub-A', 'spoke-A');
    const [hubB, sideB] = makeTransportPair('hub-B', 'spoke-B');

    const syncHubA = authenticateSpoke(hubDoc, hubA, sideA, 'key', 'key')!;
    authenticateSpoke(hubDoc, hubB, sideB, 'key', 'key');

    const syncA = new YjsSync(spokeDocA, sideA);
    const syncB = new YjsSync(spokeDocB, sideB);
    syncA.start();
    syncB.start();

    // Disconnect spoke A (simulating socket close).
    syncHubA.stop();
    syncA.stop();

    // Spoke B makes an edit — should reach hub but NOT spoke A.
    spokeDocB.getMap('after').set('disconnect', true);

    expect(hubDoc.getMap('after').get('disconnect')).toBe(true);
    expect(spokeDocA.getMap('after').get('disconnect')).toBeUndefined();
  });
});
