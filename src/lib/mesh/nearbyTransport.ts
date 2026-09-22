/**
 * A Transport over one Nearby Connections endpoint: a plain byte pipe (no
 * framing; the layer above owns message boundaries). Nearby BYTES payloads cap
 * at ~32 KB, so larger frames are sent in ordered chunks; the receiver's
 * FrameReader reassembles them as it would any byte stream.
 */
import type { EventSubscription } from 'expo-modules-core';
import FieldMeshNearby from '../../../modules/fieldmesh-nearby';
import { base64ToBytes, bytesToBase64 } from '../base64';
import type { Transport } from './framing';

const CHUNK = 30 * 1024;

export class NearbyTransport implements Transport {
  readonly name: string;
  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler: ((status: 'open' | 'closed' | 'error', detail?: string) => void) | null = null;
  private subs: EventSubscription[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly endpointId: string) {
    this.name = `nearby:${endpointId}`;
    if (!FieldMeshNearby) return;
    this.subs.push(
      FieldMeshNearby.addListener('onPayload', (e) => {
        if (e.endpointId !== this.endpointId) return;
        this.receiveHandler?.(base64ToBytes(e.data));
      })
    );
    this.subs.push(
      FieldMeshNearby.addListener('onDisconnected', (e) => {
        if (e.endpointId !== this.endpointId) return;
        this.statusHandler?.('closed', e.reason);
      })
    );
  }

  send(bytes: Uint8Array): Promise<void> {
    if (!FieldMeshNearby) return Promise.reject(new Error('Nearby module unavailable'));
    const native = FieldMeshNearby;
    // Serialise sends so chunks of one frame never interleave with another frame.
    this.queue = this.queue.then(async () => {
      for (let off = 0; off < bytes.length; off += CHUNK) {
        await native.sendPayload(this.endpointId, bytesToBase64(bytes.subarray(off, Math.min(off + CHUNK, bytes.length))));
      }
    });
    return this.queue;
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }

  onStatus(handler: (status: 'open' | 'closed' | 'error', detail?: string) => void): void {
    this.statusHandler = handler;
  }

  async close(): Promise<void> {
    for (const s of this.subs) s.remove();
    this.subs = [];
    try {
      await FieldMeshNearby?.disconnect(this.endpointId);
    } catch {
      /* already gone */
    }
    this.statusHandler?.('closed');
  }
}
