/**
 * Exercises the spoke-side handshake against an in-memory stand-in for the hub's
 * accept path, byte for byte identical to tcpHub.ts: read one framed
 * SESSION_KEY off the raw stream, then hand the socket (and any bytes that
 * arrived with it) to a Transport + YjsSync.
 *
 * The case worth having a test for is packet coalescing: TCP is free to deliver
 * the key and the first sync bytes in a single chunk, and the hub consumes that
 * chunk itself, so without replaying the remainder the handshake stalls.
 */

import * as Y from 'yjs';
import {attachSpokeSync} from '../joinSession';
import {Transport, TransportStatus} from '../../transports/types';
import {FrameReader} from '../../transports/framing';
import {Msg, decode} from '../../transports/messages';
import {YjsSync} from '../../transports/yjsSync';

/** One end of a byte pipe. Delivery is synchronous and unframed, like a socket. */
class PipeEnd implements Transport {
  readonly name = 'pipe';
  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler:
    | ((status: TransportStatus, detail?: string) => void)
    | null = null;
  peer: PipeEnd | null = null;

  /** Queue writes instead of delivering, to force the coalescing case. */
  buffering = false;
  private pending: Uint8Array[] = [];

  async send(bytes: Uint8Array): Promise<void> {
    this.deliver(bytes);
  }

  deliver(bytes: Uint8Array): void {
    if (!this.peer) return;
    if (this.peer.buffering) {
      this.peer.pending.push(bytes);
      return;
    }
    this.peer.receiveHandler?.(bytes);
  }

  /** Flush everything queued while buffering as ONE chunk. */
  flushCoalesced(): void {
    const total = this.pending.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of this.pending) {
      merged.set(b, off);
      off += b.length;
    }
    this.pending = [];
    this.buffering = false;
    if (merged.length > 0) {
      this.receiveHandler?.(merged);
    }
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }
  onStatus(
    handler: (status: TransportStatus, detail?: string) => void,
  ): void {
    this.statusHandler = handler;
  }
  injectReceived(bytes: Uint8Array): void {
    if (bytes.length > 0) this.receiveHandler?.(bytes);
  }
  async open(): Promise<void> {
    this.statusHandler?.('open');
  }
  async close(): Promise<void> {
    this.statusHandler?.('closed');
  }
}

function makePipe(): [PipeEnd, PipeEnd] {
  const a = new PipeEnd();
  const b = new PipeEnd();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

interface HubResult {
  authenticated: boolean;
  destroyed: boolean;
  sync: YjsSync | null;
}

/**
 * Mirrors tcpHub.ts's per-connection accept logic over a PipeEnd.
 * Returns a handle whose flags the tests assert on.
 */
function acceptSpoke(
  hubDoc: Y.Doc,
  hubSide: PipeEnd,
  expectedKey: string,
): HubResult {
  const reader = new FrameReader();
  const expectedKeyBytes = new TextEncoder().encode(expectedKey);
  const result: HubResult = {
    authenticated: false,
    destroyed: false,
    sync: null,
  };

  hubSide.onReceive((chunk) => {
    if (result.authenticated || result.destroyed) return;

    for (const f of reader.push(chunk)) {
      const {type, payload} = decode(f);

      if (type !== Msg.SESSION_KEY) {
        result.destroyed = true;
        return;
      }
      if (
        payload.length !== expectedKeyBytes.length ||
        !payload.every((b, i) => b === expectedKeyBytes[i])
      ) {
        result.destroyed = true;
        return;
      }

      result.authenticated = true;
      const sync = new YjsSync(hubDoc, hubSide);
      result.sync = sync;
      sync.start();
      // Replay whatever arrived in the same chunk as the key.
      hubSide.injectReceived(reader.remaining());
      return;
    }
  });

  return result;
}

const KEY = 'ABCD2345EFGH';

describe('spoke join handshake', () => {
  it('authenticates and syncs pre-existing hub state to the spoke', () => {
    const [hubSide, spokeSide] = makePipe();
    const hubDoc = new Y.Doc();
    hubDoc.getMap('fields').set('crop', 'wheat');

    const hub = acceptSpoke(hubDoc, hubSide, KEY);

    const spokeDoc = new Y.Doc();
    attachSpokeSync(spokeDoc, spokeSide, KEY, (b) => spokeSide.deliver(b));

    expect(hub.authenticated).toBe(true);
    expect(hub.destroyed).toBe(false);
    expect(spokeDoc.getMap('fields').get('crop')).toBe('wheat');
  });

  it('propagates spoke edits to the hub after joining', () => {
    const [hubSide, spokeSide] = makePipe();
    const hubDoc = new Y.Doc();
    acceptSpoke(hubDoc, hubSide, KEY);

    const spokeDoc = new Y.Doc();
    attachSpokeSync(spokeDoc, spokeSide, KEY, (b) => spokeSide.deliver(b));

    spokeDoc.getMap('fields').set('inspector', 'Athidh');
    expect(hubDoc.getMap('fields').get('inspector')).toBe('Athidh');
  });

  it('is rejected by the hub when the session key is wrong', () => {
    const [hubSide, spokeSide] = makePipe();
    const hubDoc = new Y.Doc();
    hubDoc.getMap('fields').set('crop', 'wheat');

    const hub = acceptSpoke(hubDoc, hubSide, KEY);

    const spokeDoc = new Y.Doc();
    attachSpokeSync(spokeDoc, spokeSide, 'WRONGKEY9999', (b) =>
      spokeSide.deliver(b),
    );

    expect(hub.authenticated).toBe(false);
    expect(hub.destroyed).toBe(true);
    // No sync attached, so nothing of the hub's doc leaks to an unauthorised spoke.
    expect(spokeDoc.getMap('fields').get('crop')).toBeUndefined();
  });

  it('completes when the key and first sync bytes arrive in one packet', () => {
    const [hubSide, spokeSide] = makePipe();
    const hubDoc = new Y.Doc();
    hubDoc.getMap('fields').set('crop', 'wheat');

    const hub = acceptSpoke(hubDoc, hubSide, KEY);

    // Hold everything the spoke writes, then deliver it as a single chunk —
    // the key frame and the spoke's state vector together.
    hubSide.buffering = true;
    const spokeDoc = new Y.Doc();
    spokeDoc.getMap('fields').set('note', 'from-spoke');
    attachSpokeSync(spokeDoc, spokeSide, KEY, (b) => spokeSide.deliver(b));
    hubSide.flushCoalesced();

    expect(hub.authenticated).toBe(true);
    // The state vector survived the coalesced packet, so both directions synced.
    expect(spokeDoc.getMap('fields').get('crop')).toBe('wheat');
    expect(hubDoc.getMap('fields').get('note')).toBe('from-spoke');
  });
});
