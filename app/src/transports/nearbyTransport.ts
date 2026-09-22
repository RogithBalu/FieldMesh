/**
 * A Transport over one Nearby Connections endpoint.
 *
 * Same contract as TcpSocketTransport: a plain byte pipe that does no framing,
 * so the layer above owns message boundaries and a Nearby link is
 * interchangeable with a Wi-Fi one. That is what lets ChainRelay treat an
 * out-of-range phone exactly like an in-range one.
 *
 * Nearby delivers BYTES payloads whole rather than as a stream, but the
 * FrameReader above handles both, so nothing here depends on that.
 */

import {NativeEventEmitter, NativeModules} from 'react-native';
import {Transport, TransportStatus} from './types';

const {NearbyModule} = NativeModules;

export const NearbyEvent = {
  ENDPOINT_FOUND: 'nearbyEndpointFound',
  ENDPOINT_LOST: 'nearbyEndpointLost',
  CONNECTED: 'nearbyConnected',
  DISCONNECTED: 'nearbyDisconnected',
  PAYLOAD: 'nearbyPayload',
} as const;

export interface NearbyEndpoint {
  endpointId: string;
  name?: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return global.btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = global.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export class NearbyTransport implements Transport {
  readonly name: string;
  readonly endpointId: string;

  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler:
    | ((status: TransportStatus, detail?: string) => void)
    | null = null;
  private subscriptions: Array<{remove: () => void}> = [];

  constructor(endpointId: string) {
    this.endpointId = endpointId;
    this.name = `nearby:${endpointId}`;

    const emitter = new NativeEventEmitter(NearbyModule);

    this.subscriptions.push(
      emitter.addListener(
        NearbyEvent.PAYLOAD,
        (e: {endpointId: string; data: string}) => {
          // One emitter serves every endpoint, so ignore other peers' traffic.
          if (e.endpointId !== this.endpointId) return;
          this.receiveHandler?.(fromBase64(e.data));
        },
      ),
    );

    this.subscriptions.push(
      emitter.addListener(
        NearbyEvent.DISCONNECTED,
        (e: {endpointId: string; reason?: string}) => {
          if (e.endpointId !== this.endpointId) return;
          this.statusHandler?.('closed', e.reason);
        },
      ),
    );
  }

  async send(bytes: Uint8Array): Promise<void> {
    await NearbyModule.sendPayload(this.endpointId, toBase64(bytes));
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }

  onStatus(
    handler: (status: TransportStatus, detail?: string) => void,
  ): void {
    this.statusHandler = handler;
  }

  async open(): Promise<void> {
    // The endpoint is already connected by the time a transport is built for it.
    this.statusHandler?.('open');
  }

  async close(): Promise<void> {
    for (const s of this.subscriptions) {
      s.remove();
    }
    this.subscriptions = [];
    await NearbyModule.disconnect(this.endpointId);
    this.statusHandler?.('closed');
  }
}

// ─── Discovery / advertising ─────────────────────────────────────────────────

/** Advertise as a bridge, for phones that can't reach the hub directly. */
export async function startAdvertising(deviceName: string): Promise<void> {
  return NearbyModule.startAdvertising(deviceName);
}

/** Look for a bridge to relay through. */
export async function startDiscovery(): Promise<void> {
  return NearbyModule.startDiscovery();
}

export async function stopAdvertising(): Promise<void> {
  return NearbyModule.stopAdvertising();
}

export async function stopDiscovery(): Promise<void> {
  return NearbyModule.stopDiscovery();
}

export async function requestConnection(
  deviceName: string,
  endpointId: string,
): Promise<void> {
  return NearbyModule.requestConnection(deviceName, endpointId);
}

export async function stopAllNearby(): Promise<void> {
  return NearbyModule.stopAll();
}
