/**
 * TcpSocketTransport — Transport implementation wrapping a single
 * react-native-tcp-socket Socket (client-side or accepted server connection).
 *
 * This is a plain byte pipe: it does not frame. Message boundaries are owned by
 * the layer above (YjsSync frames with frame() and reassembles with its own
 * FrameReader), which is what lets the same wire format carry the hub's
 * session-key handshake and the sync stream that follows it.
 *
 * Socket 'close'/'error' events are mapped to onStatus callbacks.
 */

import TcpSocket from 'react-native-tcp-socket';
import { Transport, TransportStatus } from './types';

export class TcpSocketTransport implements Transport {
  readonly name = 'tcp';

  private socket: TcpSocket.Socket;
  private receiveHandler: ((bytes: Uint8Array) => void) | null = null;
  private statusHandler: ((status: TransportStatus, detail?: string) => void) | null = null;

  /**
   * @param socket An already-connected (or just-accepted) tcp socket.
   */
  constructor(socket: TcpSocket.Socket) {
    this.socket = socket;

    this.socket.on('data', (data: Buffer | string) => {
      const chunk = typeof data === 'string'
        ? new Uint8Array(Buffer.from(data))
        : new Uint8Array(data);

      this.receiveHandler?.(chunk);
    });

    this.socket.on('close', (hadError: boolean) => {
      this.statusHandler?.('closed', hadError ? 'closed with error' : undefined);
    });

    this.socket.on('error', (err: Error) => {
      this.statusHandler?.('error', err.message);
    });
  }

  async send(bytes: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // react-native-tcp-socket's signature is write(buffer, encoding, cb) —
      // passing the callback second silently leaves the promise unsettled.
      this.socket.write(Buffer.from(bytes), undefined, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onReceive(handler: (bytes: Uint8Array) => void): void {
    this.receiveHandler = handler;
  }

  /**
   * Deliver bytes that were read off the socket before this transport existed.
   *
   * The TCP hub reads the session-key frame itself; if the spoke's first sync
   * bytes arrived in the same packet, they are already consumed from the socket
   * and would otherwise be lost, stalling the handshake.
   */
  injectReceived(bytes: Uint8Array): void {
    if (bytes.length > 0) {
      this.receiveHandler?.(bytes);
    }
  }

  onStatus(handler: (status: TransportStatus, detail?: string) => void): void {
    this.statusHandler = handler;
  }

  async open(): Promise<void> {
    // Socket is already connected (passed in constructor).
    this.statusHandler?.('open');
  }

  async close(): Promise<void> {
    this.socket.destroy();
    this.statusHandler?.('closed');
  }
}
