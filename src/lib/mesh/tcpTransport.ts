/**
 * Transport over one TCP connection of the FieldMeshHotspot module — either a
 * client the hub accepted (`server` side) or our own connection to a hub
 * (`client` side). Plain byte pipe; framing lives above.
 */
import type { EventSubscription } from 'expo-modules-core';
import FieldMeshHotspot from '../../../modules/fieldmesh-hotspot';
import { base64ToBytes, bytesToBase64 } from '../base64';
import type { Transport } from './framing';

export class TcpTransport implements Transport {
  readonly name: string;
  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler: ((status: 'open' | 'closed' | 'error', detail?: string) => void) | null = null;
  private subs: EventSubscription[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly side: 'server' | 'client',
    readonly id: string
  ) {
    this.name = `tcp-${side}:${id}`;
    const native = FieldMeshHotspot;
    if (!native) return;
    if (side === 'server') {
      this.subs.push(
        native.addListener('onServerData', (e) => {
          if (e.clientId === id) this.receiveHandler?.(base64ToBytes(e.data));
        }),
        native.addListener('onClientDisconnected', (e) => {
          if (e.clientId === id) this.statusHandler?.('closed', 'client disconnected');
        })
      );
    } else {
      this.subs.push(
        native.addListener('onData', (e) => {
          if (e.connId === id) this.receiveHandler?.(base64ToBytes(e.data));
        }),
        native.addListener('onDisconnected', (e) => {
          if (e.connId === id) this.statusHandler?.('closed', 'hub disconnected');
        })
      );
    }
  }

  send(bytes: Uint8Array): Promise<void> {
    const native = FieldMeshHotspot;
    if (!native) return Promise.reject(new Error('Hotspot module unavailable'));
    const b64 = bytesToBase64(bytes);
    this.queue = this.queue.then(() => (this.side === 'server' ? native.sendToClient(this.id, b64) : native.send(this.id, b64)));
    return this.queue;
  }

  /** Bytes read before this transport existed (the hub's key handshake). */
  injectReceived(bytes: Uint8Array): void {
    if (bytes.length > 0) this.receiveHandler?.(bytes);
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
      if (this.side === 'server') await FieldMeshHotspot?.disconnectClient(this.id);
      else await FieldMeshHotspot?.disconnect(this.id);
    } catch {
      /* already gone */
    }
    this.statusHandler?.('closed');
  }
}
