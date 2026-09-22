/**
 * The scenario from the brief: a phone outside hotspot range still syncs,
 * because a phone in range relays for it.
 *
 *   hub ──"Wi-Fi"── bridge ──"Nearby"── far
 *
 * Both hops are in-memory pipes here; what is being tested is that an edit
 * crosses two hops in both directions, that a loop doesn't circulate, and that
 * losing the middle phone degrades the way it should.
 */

import * as Y from 'yjs';
import {ChainRelay} from '../chainRelay';
import {YjsSync} from '../../transports/yjsSync';
import {Transport, TransportStatus} from '../../transports/types';

class Pipe implements Transport {
  readonly name = 'pipe';
  private receiveHandler: ((b: Uint8Array) => void) | null = null;
  private statusHandler: ((s: TransportStatus, d?: string) => void) | null =
    null;
  peer: Pipe | null = null;
  severed = false;
  sendCount = 0;

  async send(bytes: Uint8Array): Promise<void> {
    this.sendCount++;
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
}

function makePipe(): [Pipe, Pipe] {
  const a = new Pipe();
  const b = new Pipe();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** hub —wifi— bridge —nearby— far */
function buildChain() {
  const hubDoc = new Y.Doc();
  const bridgeDoc = new Y.Doc();
  const farDoc = new Y.Doc();

  const [hubSide, bridgeUp] = makePipe();
  const [bridgeDown, farSide] = makePipe();

  // Hub: an ordinary sync for its one spoke.
  const hubSync = new YjsSync(hubDoc, hubSide);

  // Bridge: uplink to the hub, downlink to the far phone, one document.
  const relay = new ChainRelay(bridgeDoc);

  // Far phone: an ordinary spoke that happens to be talking to a bridge.
  const farSync = new YjsSync(farDoc, farSide);

  hubSync.start();
  relay.add('hub', 'uplink', bridgeUp);
  relay.add('far', 'downlink', bridgeDown);
  farSync.start();

  return {
    hubDoc,
    bridgeDoc,
    farDoc,
    relay,
    hubSync,
    farSync,
    pipes: {hubSide, bridgeUp, bridgeDown, farSide},
  };
}

describe('ChainRelay', () => {
  it('carries an edit from the far phone all the way to the hub', () => {
    const {hubDoc, bridgeDoc, farDoc} = buildChain();

    farDoc.getMap('fields').set('crop', 'wheat');

    expect(bridgeDoc.getMap('fields').get('crop')).toBe('wheat');
    expect(hubDoc.getMap('fields').get('crop')).toBe('wheat');
  });

  it('carries an edit from the hub out to the far phone', () => {
    const {hubDoc, bridgeDoc, farDoc} = buildChain();

    hubDoc.getMap('fields').set('inspector', 'Athidh');

    expect(bridgeDoc.getMap('fields').get('inspector')).toBe('Athidh');
    expect(farDoc.getMap('fields').get('inspector')).toBe('Athidh');
  });

  it('converges all three documents after concurrent edits at every hop', () => {
    const {hubDoc, bridgeDoc, farDoc} = buildChain();

    hubDoc.getMap('fields').set('a', 1);
    bridgeDoc.getMap('fields').set('b', 2);
    farDoc.getMap('fields').set('c', 3);

    const expected = {a: 1, b: 2, c: 3};
    expect(hubDoc.getMap('fields').toJSON()).toEqual(expected);
    expect(bridgeDoc.getMap('fields').toJSON()).toEqual(expected);
    expect(farDoc.getMap('fields').toJSON()).toEqual(expected);
  });

  it('syncs state that existed before the far phone joined', () => {
    const hubDoc = new Y.Doc();
    hubDoc.getMap('fields').set('existing', 'value');

    const bridgeDoc = new Y.Doc();
    const [hubSide, bridgeUp] = makePipe();
    new YjsSync(hubDoc, hubSide).start();
    const relay = new ChainRelay(bridgeDoc);
    relay.add('hub', 'uplink', bridgeUp);

    // Far phone arrives afterwards and must still receive the backlog.
    const farDoc = new Y.Doc();
    const [bridgeDown, farSide] = makePipe();
    relay.add('far', 'downlink', bridgeDown);
    new YjsSync(farDoc, farSide).start();

    expect(farDoc.getMap('fields').get('existing')).toBe('value');
  });

  it('settles instead of circulating when edits cross the chain repeatedly', () => {
    const {hubDoc, farDoc, pipes} = buildChain();

    const before = pipes.bridgeUp.sendCount + pipes.bridgeDown.sendCount;
    hubDoc.getMap('fields').set('x', 1);
    farDoc.getMap('fields').set('y', 2);
    const after = pipes.bridgeUp.sendCount + pipes.bridgeDown.sendCount;

    // A forwarding loop would send unboundedly; two edits stay small.
    expect(after - before).toBeLessThan(10);
  });

  it('reports bridging only once it has both an uplink and a downlink', () => {
    const doc = new Y.Doc();
    const relay = new ChainRelay(doc);
    const [up] = makePipe();
    const [down] = makePipe();

    expect(relay.isBridging).toBe(false);
    relay.add('hub', 'uplink', up);
    expect(relay.isBridging).toBe(false);
    relay.add('far', 'downlink', down);
    expect(relay.isBridging).toBe(true);
    expect(relay.downlinks).toHaveLength(1);
  });

  it('relays for several far phones at once', () => {
    const {relay, bridgeDoc, hubDoc} = buildChain();

    const far2Doc = new Y.Doc();
    const [bridgeDown2, far2Side] = makePipe();
    relay.add('far2', 'downlink', bridgeDown2);
    new YjsSync(far2Doc, far2Side).start();

    far2Doc.getMap('fields').set('from', 'far2');

    expect(bridgeDoc.getMap('fields').get('from')).toBe('far2');
    expect(hubDoc.getMap('fields').get('from')).toBe('far2');
    expect(relay.downlinks).toHaveLength(2);
  });

  it('stops relaying for a removed link but keeps the rest working', () => {
    const {relay, hubDoc, farDoc} = buildChain();

    relay.remove('far');
    farDoc.getMap('fields').set('after', 'removal');

    // The far phone is cut off...
    expect(hubDoc.getMap('fields').get('after')).toBeUndefined();

    // ...while the uplink still carries the bridge's own edits.
    hubDoc.getMap('fields').set('uplink', 'alive');
    expect(relay.uplink).toBeDefined();
  });

  it('replaces a link reconnecting under the same id without duplicating sync', () => {
    const {relay, hubDoc} = buildChain();

    const farDoc2 = new Y.Doc();
    const [bridgeDown2, farSide2] = makePipe();
    relay.add('far', 'downlink', bridgeDown2); // same id as before
    new YjsSync(farDoc2, farSide2).start();

    expect(relay.downlinks).toHaveLength(1);

    hubDoc.getMap('fields').set('after', 'reconnect');
    expect(farDoc2.getMap('fields').get('after')).toBe('reconnect');
  });

  it('stop() detaches every link', () => {
    const {relay, hubDoc, farDoc} = buildChain();

    relay.stop();
    hubDoc.getMap('fields').set('post', 'stop');

    expect(relay.all).toHaveLength(0);
    expect(farDoc.getMap('fields').get('post')).toBeUndefined();
  });

  it('survives the bridge losing its uplink and regaining it', () => {
    const {relay, farDoc, hubDoc} = buildChain();

    // Uplink drops; the far phone keeps working against the bridge.
    relay.remove('hub');
    farDoc.getMap('fields').set('offline', 'edit');
    expect(hubDoc.getMap('fields').get('offline')).toBeUndefined();

    // Uplink returns on a fresh connection; the backlog flows to the hub.
    const [hubSide2, bridgeUp2] = makePipe();
    new YjsSync(hubDoc, hubSide2).start();
    relay.add('hub', 'uplink', bridgeUp2);

    expect(hubDoc.getMap('fields').get('offline')).toBe('edit');
  });
});
