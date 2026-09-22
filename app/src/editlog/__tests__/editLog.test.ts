/**
 * The edit log is what the server's dispute detection reads, so these tests
 * assert the shape and causality server/src/edits/extract.ts depends on:
 * a top-level "edits" Y.Map, keyed by edit id, holding EditEntry values, with
 * `parents` naming the edits that were current when the change was made.
 */

import * as Y from 'yjs';
import {EditEntry} from '@fieldmesh/shared';
import {EditLog, EDITS_MAP, FIELDS_MAP} from '../editLog';
import {YjsSync} from '../../transports/yjsSync';
import {Transport, TransportStatus} from '../../transports/types';

class Pipe implements Transport {
  readonly name = 'pipe';
  private rx: ((b: Uint8Array) => void) | null = null;
  private st: ((s: TransportStatus, d?: string) => void) | null = null;
  peer: Pipe | null = null;
  severed = false;

  async send(b: Uint8Array): Promise<void> {
    if (!this.severed) this.peer?.rx?.(b);
  }
  onReceive(h: (b: Uint8Array) => void): void {
    this.rx = h;
  }
  onStatus(h: (s: TransportStatus, d?: string) => void): void {
    this.st = h;
  }
  async open(): Promise<void> {
    this.st?.('open');
  }
  async close(): Promise<void> {
    this.st?.('closed');
  }
}

function makePipe(): [Pipe, Pipe] {
  const a = new Pipe();
  const b = new Pipe();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

let counter = 0;
function seqId(): string {
  return `e${++counter}`;
}

beforeEach(() => {
  counter = 0;
});

function makeLog(doc: Y.Doc, device: string, author: string) {
  return new EditLog(doc, {deviceId: device, author, newId: seqId});
}

describe('EditLog shape, as the server reads it', () => {
  it('writes entries into a top-level "edits" map keyed by edit id', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    const entry = log.set('moisture', 42);

    // This is precisely what extract.ts walks.
    const editsMap = doc.getMap(EDITS_MAP);
    expect(editsMap.size).toBe(1);
    expect(editsMap.get(entry.id)).toEqual(entry);
  });

  it('produces every field EditEntry declares', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    const e: EditEntry<number> = log.set('moisture', 42);

    expect(e).toEqual({
      id: expect.any(String),
      fieldId: 'moisture',
      value: 42,
      author: 'Athidh',
      device: 'dev-1',
      hlc: expect.stringMatching(/^\d+:\d+:dev-1$/),
      parents: [],
      schemaVersion: 1,
    });
  });

  it('also updates the plain field value for the UI to render', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    log.set('crop', 'wheat');

    expect(doc.getMap(FIELDS_MAP).get('crop')).toBe('wheat');
  });

  it('writes the log entry and the field value in one transaction', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    let updates = 0;
    doc.on('update', () => updates++);
    log.set('crop', 'wheat');

    // One update, so a peer can never see the value without its edit.
    expect(updates).toBe(1);
  });
});

describe('causality', () => {
  it('names the previous edit as parent when editing sequentially', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    const first = log.set('moisture', 10);
    const second = log.set('moisture', 20);

    expect(first.parents).toEqual([]);
    expect(second.parents).toEqual([first.id]);
    expect(log.headsFor('moisture')).toEqual([second.id]);
  });

  it('keeps fields independent of each other', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    const a = log.set('moisture', 10);
    const b = log.set('crop', 'wheat');

    // An edit to one field must not claim another field's edit as a parent.
    expect(b.parents).toEqual([]);
    expect(log.headsFor('moisture')).toEqual([a.id]);
    expect(log.headsFor('crop')).toEqual([b.id]);
  });

  it('advances the HLC on every edit', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    const first = log.set('f', 1);
    const second = log.set('f', 2);

    expect(second.hlc > first.hlc).toBe(true);
  });

  it('reports the latest value by HLC', () => {
    const doc = new Y.Doc();
    const log = makeLog(doc, 'dev-1', 'Athidh');

    log.set('moisture', 10);
    log.set('moisture', 20);

    expect(log.currentValue('moisture')).toBe(20);
  });
});

describe('offline concurrent edits — what a dispute is', () => {
  /**
   * Two devices, synced, then separated, then reunited.
   *
   * Reuniting means a fresh handshake, not just an unblocked pipe: Yjs sends
   * deltas, so edits made while apart only cross on a new state-vector
   * exchange — which is what reconnect.ts and ChainRelay.add actually do.
   */
  function splitBrain() {
    const [pa, pb] = makePipe();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const syncA = new YjsSync(docA, pa);
    const syncB = new YjsSync(docB, pb);
    syncA.start();
    syncB.start();

    const reunite = () => {
      pa.severed = false;
      pb.severed = false;
      syncA.stop();
      syncB.stop();
      new YjsSync(docA, pa).start();
      new YjsSync(docB, pb).start();
    };

    const logA = new EditLog(docA, {
      deviceId: 'dev-A',
      author: 'Athidh',
      newId: () => `a${++counter}`,
    });
    const logB = new EditLog(docB, {
      deviceId: 'dev-B',
      author: 'Rogith',
      newId: () => `b${++counter}`,
    });

    // A shared starting point both devices have seen.
    logA.set('moisture', 10);

    return {docA, docB, logA, logB, pa, pb, reunite};
  }

  it('produces two heads when both devices edit while apart', () => {
    const {logA, logB, pa, pb, reunite} = splitBrain();

    // Radios drop.
    pa.severed = true;
    pb.severed = true;

    const offlineA = logA.set('moisture', 20);
    const offlineB = logB.set('moisture', 30);

    // Both branched from the same edit, having not seen each other.
    expect(offlineA.parents).toEqual(offlineB.parents);

    reunite();

    // Two heads on one field is the signal disputes.ts looks for.
    const heads = logA.headsFor('moisture');
    expect(heads).toHaveLength(2);
    expect(heads).toEqual(expect.arrayContaining([offlineA.id, offlineB.id]));
    expect(logA.disputedFields()).toContain('moisture');
  });

  it('leaves no dispute when edits are sequential rather than concurrent', () => {
    const {logA, logB} = splitBrain();

    // B stays connected and sees A's edit before making its own.
    logA.set('moisture', 20);
    const later = logB.set('moisture', 30);

    expect(later.parents).toHaveLength(1);
    expect(logB.headsFor('moisture')).toEqual([later.id]);
    expect(logB.disputedFields()).not.toContain('moisture');
  });

  it('converges the log itself across both devices', () => {
    const {docA, docB, logA, logB, pa, pb, reunite} = splitBrain();

    pa.severed = true;
    pb.severed = true;
    logA.set('moisture', 20);
    logB.set('moisture', 30);
    reunite();

    // Both sides end up with the same set of edits.
    expect(docA.getMap(EDITS_MAP).size).toBe(docB.getMap(EDITS_MAP).size);
    expect(logA.entriesFor('moisture').map((e) => e.id).sort()).toEqual(
      logB.entriesFor('moisture').map((e) => e.id).sort(),
    );
  });

  it('carries the log across a chain relay to the hub', () => {
    // far —— bridge —— hub, the topology from the brief.
    const [farSide, bridgeDown] = makePipe();
    const [bridgeUp, hubSide] = makePipe();

    const farDoc = new Y.Doc();
    const bridgeDoc = new Y.Doc();
    const hubDoc = new Y.Doc();

    new YjsSync(farDoc, farSide).start();
    new YjsSync(bridgeDoc, bridgeDown).start();
    new YjsSync(bridgeDoc, bridgeUp).start();
    new YjsSync(hubDoc, hubSide).start();

    const farLog = new EditLog(farDoc, {
      deviceId: 'dev-far',
      author: 'Athidh',
      newId: seqId,
    });
    const entry = farLog.set('moisture', 77);

    // The hub's copy is what gets persisted and extracted server-side.
    expect(hubDoc.getMap(EDITS_MAP).get(entry.id)).toEqual(entry);
    expect(hubDoc.getMap(FIELDS_MAP).get('moisture')).toBe(77);
  });
});
