import * as Y from 'yjs';
import {Heartbeat} from '../heartbeat';
import {Transport, TransportStatus} from '../types';
import {frame, FrameReader} from '../framing';
import {Msg, encode, decode} from '../messages';
import {YjsSync} from '../yjsSync';

class FakeTransport implements Transport {
  readonly name = 'fake';
  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler:
    | ((status: TransportStatus, detail?: string) => void)
    | null = null;
  peer: FakeTransport | null = null;

  /** Drop everything written, to simulate a link that has gone away. */
  blackhole = false;
  readonly sent: Uint8Array[] = [];

  async send(bytes: Uint8Array): Promise<void> {
    this.sent.push(bytes);
    if (this.blackhole) return;
    this.peer?.receiveHandler?.(bytes);
  }
  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }
  onStatus(h: (status: TransportStatus, detail?: string) => void): void {
    this.statusHandler = h;
  }
  async open(): Promise<void> {
    this.statusHandler?.('open');
  }
  async close(): Promise<void> {
    this.statusHandler?.('closed');
  }

  /** Message types this transport has written, in order. */
  sentTypes(): number[] {
    const reader = new FrameReader();
    const types: number[] = [];
    for (const chunk of this.sent) {
      for (const f of reader.push(chunk)) {
        types.push(decode(f).type);
      }
    }
    return types;
  }
}

function makePair(): [FakeTransport, FakeTransport] {
  const a = new FakeTransport();
  const b = new FakeTransport();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

describe('Heartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends a PING on each interval while the peer answers', () => {
    const [a, b] = makePair();
    const hb = new Heartbeat(a, {intervalMs: 1000});
    const hbPeer = new Heartbeat(b, {intervalMs: 100000}); // answers, never pings
    hb.start();
    hbPeer.start();

    jest.advanceTimersByTime(3000);

    expect(a.sentTypes()).toEqual([Msg.PING, Msg.PING, Msg.PING]);
    hb.stop();
    hbPeer.stop();
  });

  it('answers a peer PING with a PONG', () => {
    const [a, b] = makePair();
    const hbA = new Heartbeat(a, {intervalMs: 1000});
    const hbB = new Heartbeat(b, {intervalMs: 1000});
    hbA.start();
    hbB.start();

    jest.advanceTimersByTime(1000);

    // Each side pinged once and answered the other's ping.
    expect(b.sentTypes()).toContain(Msg.PONG);
    expect(a.sentTypes()).toContain(Msg.PONG);
    hbA.stop();
    hbB.stop();
  });

  it('stays alive indefinitely while the peer answers', () => {
    const [a, b] = makePair();
    const onDead = jest.fn();
    const hbA = new Heartbeat(a, {intervalMs: 1000, onDead});
    const hbB = new Heartbeat(b, {intervalMs: 1000});
    hbA.start();
    hbB.start();

    jest.advanceTimersByTime(60000);

    expect(onDead).not.toHaveBeenCalled();
    expect(hbA.isDead).toBe(false);
    hbA.stop();
    hbB.stop();
  });

  it('declares the link dead after maxMissed unanswered pings', () => {
    const [a] = makePair(); // no peer heartbeat, so nothing ever answers
    const onDead = jest.fn();
    const hb = new Heartbeat(a, {intervalMs: 1000, maxMissed: 2, onDead});
    hb.start();

    jest.advanceTimersByTime(2000); // two pings sent, both unanswered
    expect(onDead).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000); // third tick sees the missed count
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(hb.isDead).toBe(true);
  });

  it('survives a single dropped pong', () => {
    const [a, b] = makePair();
    const onDead = jest.fn();
    const hbA = new Heartbeat(a, {intervalMs: 1000, maxMissed: 2, onDead});
    const hbB = new Heartbeat(b, {intervalMs: 1000});
    hbA.start();
    hbB.start();

    b.blackhole = true; // one round trip lost
    jest.advanceTimersByTime(1000);
    b.blackhole = false;
    jest.advanceTimersByTime(1000);

    expect(onDead).not.toHaveBeenCalled();
    hbA.stop();
    hbB.stop();
  });

  it('reports dead only once and stops pinging afterwards', () => {
    const [a] = makePair();
    const onDead = jest.fn();
    const hb = new Heartbeat(a, {intervalMs: 1000, maxMissed: 1, onDead});
    hb.start();

    jest.advanceTimersByTime(30000);

    expect(onDead).toHaveBeenCalledTimes(1);
    // Two pings at most: one before the counter tripped, none after.
    expect(a.sentTypes().filter((t) => t === Msg.PING).length).toBeLessThanOrEqual(2);
  });

  it('stop() prevents any further pings', () => {
    const [a] = makePair();
    const hb = new Heartbeat(a, {intervalMs: 1000});
    hb.start();
    jest.advanceTimersByTime(1000);
    const before = a.sent.length;

    hb.stop();
    jest.advanceTimersByTime(10000);

    expect(a.sent.length).toBe(before);
  });

  it('start() is idempotent', () => {
    const [a] = makePair();
    const hb = new Heartbeat(a, {intervalMs: 1000});
    hb.start();
    hb.start();

    jest.advanceTimersByTime(1000);

    expect(a.sentTypes()).toEqual([Msg.PING]);
    hb.stop();
  });
});

describe('Heartbeat composed under YjsSync', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps documents syncing while heartbeats run on the same transport', () => {
    const [a, b] = makePair();
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const hbA = new Heartbeat(a, {intervalMs: 1000});
    const hbB = new Heartbeat(b, {intervalMs: 1000});
    const syncA = new YjsSync(docA, hbA);
    const syncB = new YjsSync(docB, hbB);

    hbA.start();
    hbB.start();
    syncA.start();
    syncB.start();

    docA.getMap('fields').set('crop', 'wheat');
    expect(docB.getMap('fields').get('crop')).toBe('wheat');

    // Heartbeat traffic interleaved with sync traffic must not corrupt either.
    jest.advanceTimersByTime(5000);
    docB.getMap('fields').set('soil', 'clay');

    expect(docA.getMap('fields').toJSON()).toEqual({
      crop: 'wheat',
      soil: 'clay',
    });
    hbA.stop();
    hbB.stop();
  });

  it('does not let PING frames reach the document as updates', () => {
    const [a, b] = makePair();
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const hbA = new Heartbeat(a, {intervalMs: 1000});
    const hbB = new Heartbeat(b, {intervalMs: 1000});
    new YjsSync(docA, hbA).start();
    new YjsSync(docB, hbB).start();
    hbA.start();
    hbB.start();

    docA.getMap('fields').set('crop', 'wheat');
    const before = JSON.stringify(docB.getMap('fields').toJSON());

    jest.advanceTimersByTime(10000);

    expect(JSON.stringify(docB.getMap('fields').toJSON())).toBe(before);
    hbA.stop();
    hbB.stop();
  });

  it('a raw PONG arriving mid-stream does not disturb frame reassembly', () => {
    const [a, b] = makePair();
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const hbB = new Heartbeat(b, {intervalMs: 100000});
    const syncB = new YjsSync(docB, hbB);
    hbB.start();
    syncB.start();

    const syncA = new YjsSync(docA, a);
    syncA.start();

    // Inject an unsolicited PONG between two real updates.
    docA.getMap('fields').set('one', 1);
    a.send(frame(encode(Msg.PONG)));
    docA.getMap('fields').set('two', 2);

    expect(docB.getMap('fields').toJSON()).toEqual({one: 1, two: 2});
    hbB.stop();
  });
});
