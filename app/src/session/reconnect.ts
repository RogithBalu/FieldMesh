/**
 * Keeping a spoke joined to a site session across dropouts.
 *
 * Walking behind a wall drops the link; walking back should restore it without
 * anyone touching the phone. A rejoin is just the original handshake run again,
 * and because Yjs exchanges state vectors, the resync costs only the delta —
 * so reconnecting is cheap enough to retry aggressively.
 *
 * Backoff exists for the case that is not a dropout: a hub that has shut down.
 * Without it a spoke would hammer a dead address for the rest of the session.
 */

import * as Y from 'yjs';
import { SessionInfo } from './types';
import { JoinedSession, joinSession } from './joinSession';
import { Heartbeat } from '../transports/heartbeat';
import { TransportStatus } from '../transports/types';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stopped';

export interface ReconnectOptions {
  /** Delay before the first retry; doubles up to maxDelayMs. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Give up after this many consecutive failures. Infinity by default. */
  maxAttempts?: number;
  heartbeatIntervalMs?: number;
  onStateChange?: (state: ConnectionState, detail?: string) => void;
}

export interface ReconnectingSession {
  readonly state: ConnectionState;
  /** Consecutive failed attempts since the last successful join. */
  readonly attempts: number;
  /** Stop retrying and drop the current connection. */
  stop(): void;
}

const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;

/** Injectable so tests can drive joins and timers without sockets. */
export interface ReconnectDeps {
  join: (info: SessionInfo, doc: Y.Doc, onStatus: (s: TransportStatus, d?: string) => void)
    => Promise<JoinedSession>;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  makeHeartbeat: (session: JoinedSession, onDead: () => void) => { stop(): void };
}

const defaultDeps: ReconnectDeps = {
  join: (info, doc, onStatus) => joinSession(info, doc, { onStatus }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  makeHeartbeat: (session, onDead) => {
    const hb = new Heartbeat(session.transport, { onDead });
    hb.start();
    return hb;
  },
};

/**
 * Join a session and keep it joined, rejoining whenever the link dies.
 * Returns immediately; watch `onStateChange` for progress.
 */
export function keepSessionJoined(
  info: SessionInfo,
  doc: Y.Doc,
  options: ReconnectOptions = {},
  deps: ReconnectDeps = defaultDeps,
): ReconnectingSession {
  const {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxAttempts = Infinity,
    onStateChange,
  } = options;

  let state: ConnectionState = 'connecting';
  let attempts = 0;
  let stopped = false;
  let current: JoinedSession | null = null;
  let heartbeat: { stop(): void } | null = null;
  let timer: unknown = null;

  function setState(next: ConnectionState, detail?: string): void {
    state = next;
    onStateChange?.(next, detail);
  }

  function teardown(): void {
    heartbeat?.stop();
    heartbeat = null;
    current?.leave();
    current = null;
  }

  function scheduleRetry(reason: string): void {
    if (stopped) {
      return;
    }
    if (attempts >= maxAttempts) {
      setState('stopped', `giving up after ${attempts} attempts: ${reason}`);
      return;
    }

    // attempts is already incremented for this failure, so the first retry
    // waits initialDelayMs rather than double.
    const delay = Math.min(
      initialDelayMs * Math.pow(2, Math.max(0, attempts - 1)),
      maxDelayMs,
    );
    setState('reconnecting', `${reason}; retrying in ${delay}ms`);
    timer = deps.setTimer(connect, delay);
  }

  function connect(): void {
    if (stopped) {
      return;
    }

    deps
      .join(info, doc, (status, detail) => {
        // A socket that closes while we believe we're connected is a dropout,
        // not a shutdown — the heartbeat may not have noticed yet.
        if (
          (status === 'closed' || status === 'error') &&
          state === 'connected'
        ) {
          onLinkLost(detail ?? status);
        }
      })
      .then((session) => {
        if (stopped) {
          session.leave();
          return;
        }
        current = session;
        attempts = 0;
        heartbeat = deps.makeHeartbeat(session, () =>
          onLinkLost('heartbeat timeout'),
        );
        setState('connected');
      })
      .catch((err: Error) => {
        attempts++;
        scheduleRetry(err?.message ?? 'connect failed');
      });
  }

  function onLinkLost(reason: string): void {
    if (stopped || state === 'reconnecting') {
      return;
    }
    teardown();
    attempts++;
    scheduleRetry(reason);
  }

  connect();

  return {
    get state() {
      return state;
    },
    get attempts() {
      return attempts;
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      teardown();
      setState('stopped');
    },
  };
}
