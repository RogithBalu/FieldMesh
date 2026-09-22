/**
 * TcpHub — TCP server that accepts spoke connections, validates a session key,
 * and attaches YjsSync per authenticated spoke so all phones on the local
 * hotspot sync the same Y.Doc.
 *
 * Usage:
 *   const hub = createTcpHub(doc, 'my-session-key', 9090);
 *   // ... later
 *   hub.close();
 *
 * Protocol per spoke:
 *   1. Spoke connects via TCP.
 *   2. Hub waits for the first frame: must decode as Msg.SESSION_KEY with
 *      payload matching `expectedSessionKey` (utf-8). Timeout: 5 seconds.
 *   3. If key matches → attach YjsSync(doc, transport) and start().
 *   4. If key is wrong or timeout → close socket immediately.
 *   5. On socket disconnect → stop() YjsSync and remove from spoke map.
 */

import TcpSocket from 'react-native-tcp-socket';
import * as Y from 'yjs';
import { Transport } from '../transports/types';
import { FrameReader } from '../transports/framing';
import { Msg, decode } from '../transports/messages';
import { YjsSync } from '../transports/yjsSync';
import { TcpSocketTransport } from '../transports/tcpSocketTransport';

const SESSION_KEY_TIMEOUT_MS = 5000;

/** Info about a connected and authenticated spoke. */
export interface SpokeEntry {
  id: string;
  transport: Transport;
  sync: YjsSync;
}

export interface TcpHub {
  /** All currently connected & authenticated spokes, keyed by socket id. */
  readonly spokes: ReadonlyMap<string, SpokeEntry>;
  /** Stop the TCP server and close all spoke connections. */
  close(): void;
}

/**
 * Start a TCP hub server. The hot-path for creating it is:
 *
 *   const hub = createTcpHub(doc, sessionKey, port);
 *
 * Returns synchronously; the server starts listening immediately.
 */
export function createTcpHub(
  doc: Y.Doc,
  expectedSessionKey: string,
  port: number,
): TcpHub {
  const spokes = new Map<string, SpokeEntry>();
  const expectedKeyBytes = new TextEncoder().encode(expectedSessionKey);

  const server = TcpSocket.createServer((socket) => {
    const socketId = `${socket.remoteAddress}:${socket.remotePort}`;
    const reader = new FrameReader();
    let authenticated = false;

    // Timeout: if the spoke doesn't send a valid session key within 5s, drop it.
    const timeout = setTimeout(() => {
      if (!authenticated) {
        socket.destroy();
      }
    }, SESSION_KEY_TIMEOUT_MS);

    // Buffer incoming data until we get the first complete frame (session key).
    const onData = (data: Buffer | string) => {
      if (authenticated) return; // After auth, TcpSocketTransport handles data.

      const chunk = typeof data === 'string'
        ? new Uint8Array(Buffer.from(data))
        : new Uint8Array(data);

      const frames = reader.push(chunk);
      for (const f of frames) {
        const { type, payload } = decode(f);

        if (type !== Msg.SESSION_KEY) {
          // First message must be SESSION_KEY — anything else is a protocol violation.
          clearTimeout(timeout);
          socket.destroy();
          return;
        }

        // Compare key bytes.
        if (!bytesEqual(payload, expectedKeyBytes)) {
          clearTimeout(timeout);
          socket.destroy();
          return;
        }

        // ── Authenticated ──
        clearTimeout(timeout);
        authenticated = true;
        socket.removeListener('data', onData);

        // Wrap in Transport and attach YjsSync.
        const transport = new TcpSocketTransport(socket);
        const sync = new YjsSync(doc, transport);

        spokes.set(socketId, { id: socketId, transport, sync });
        sync.start();

        // Anything the spoke sent in the same packet as its session key was
        // already read off the socket above, so replay it into the transport
        // now that a receive handler exists.
        transport.injectReceived(reader.remaining());
        return; // Only process the first frame for auth.
      }
    };

    socket.on('data', onData);

    socket.on('close', () => {
      clearTimeout(timeout);
      const entry = spokes.get(socketId);
      if (entry) {
        entry.sync.stop();
        spokes.delete(socketId);
      }
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      const entry = spokes.get(socketId);
      if (entry) {
        entry.sync.stop();
        spokes.delete(socketId);
      }
    });
  });

  server.listen({ port, host: '0.0.0.0' });

  return {
    spokes,
    close() {
      // Stop all syncs and close the server.
      for (const [id, entry] of spokes) {
        entry.sync.stop();
        spokes.delete(id);
      }
      server.close();
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
