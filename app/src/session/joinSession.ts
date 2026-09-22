/**
 * Joining a site session as a spoke.
 *
 * Assumes the phone is already on the hub's hotspot (the user scanned the Wi-Fi
 * QR with their camera). From there:
 *
 *   1. open a TCP connection to the hub
 *   2. send frame(encode(SESSION_KEY, key)) — the hub drops the socket if it
 *      doesn't match, so a wrong key surfaces as a close, not a rejection message
 *   3. attach YjsSync, which exchanges state vectors and keeps the doc in sync
 *
 * Steps 2 and 3 happen in the same tick: TCP preserves write order, so the key
 * lands first, and attaching the transport synchronously means no hub reply can
 * be processed before there's a handler to receive it.
 */

import TcpSocket from 'react-native-tcp-socket';
import * as Y from 'yjs';
import { Transport, TransportStatus } from '../transports/types';
import { frame } from '../transports/framing';
import { Msg, encode } from '../transports/messages';
import { YjsSync } from '../transports/yjsSync';
import { TcpSocketTransport } from '../transports/tcpSocketTransport';
import { SessionInfo } from './types';

const CONNECT_TIMEOUT_MS = 10000;

export interface JoinedSession {
  readonly info: SessionInfo;
  readonly transport: Transport;
  readonly sync: YjsSync;
  /** Stop syncing and close the connection. */
  leave(): void;
}

export interface JoinOptions {
  /** Status updates from the underlying socket (connecting, open, closed, error). */
  onStatus?: (status: TransportStatus, detail?: string) => void;
  connectTimeoutMs?: number;
}

/**
 * The session-key handshake, independent of how the bytes get to the hub.
 * Exported so the flow can be exercised without a real socket.
 */
export function attachSpokeSync(
  doc: Y.Doc,
  transport: Transport,
  sessionKey: string,
  sendRaw: (bytes: Uint8Array) => void,
): YjsSync {
  const keyBytes = new TextEncoder().encode(sessionKey);
  sendRaw(frame(encode(Msg.SESSION_KEY, keyBytes)));

  const sync = new YjsSync(doc, transport);
  sync.start();
  return sync;
}

/**
 * Connect to a hub described by a scanned session QR and sync `doc` with it.
 * Rejects if the connection can't be established within the timeout.
 */
export function joinSession(
  info: SessionInfo,
  doc: Y.Doc,
  options: JoinOptions = {},
): Promise<JoinedSession> {
  const { onStatus, connectTimeoutMs = CONNECT_TIMEOUT_MS } = options;

  return new Promise<JoinedSession>((resolve, reject) => {
    let settled = false;

    onStatus?.('connecting');

    const socket = TcpSocket.createConnection(
      { host: info.host, port: info.port },
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        const transport = new TcpSocketTransport(socket);
        transport.onStatus((status, detail) => onStatus?.(status, detail));

        const sync = attachSpokeSync(doc, transport, info.key, (bytes) => {
          socket.write(Buffer.from(bytes));
        });

        onStatus?.('open');

        resolve({
          info,
          transport,
          sync,
          leave() {
            sync.stop();
            socket.destroy();
          },
        });
      },
    );

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      onStatus?.('error', 'connect timeout');
      reject(
        new Error(
          `timed out connecting to hub at ${info.host}:${info.port}`,
        ),
      );
    }, connectTimeoutMs);

    socket.on('error', (err: Error) => {
      if (settled) {
        onStatus?.('error', err.message);
        return;
      }
      settled = true;
      clearTimeout(timer);
      onStatus?.('error', err.message);
      reject(err);
    });
  });
}
