import * as Y from 'yjs';
import {keepSessionJoined, ReconnectDeps, ConnectionState} from '../reconnect';
import {SessionInfo} from '../types';
import {JoinedSession} from '../joinSession';
import {Transport, TransportStatus} from '../../transports/types';

const INFO: SessionInfo = {
  host: '192.168.49.1',
  port: 9090,
  key: 'ABCD2345EFGH',
  doc: 'inspection:test-001',
};

/** Drives joins, timers and heartbeats by hand so nothing depends on wall clock. */
class Harness {
  joinCalls = 0;
  left = 0;
  heartbeatsStopped = 0;
  states: ConnectionState[] = [];

  private pending: Array<{
    resolve: (s: JoinedSession) => void;
    reject: (e: Error) => void;
  }> = [];
  private timers: Array<{fn: () => void; ms: number}> = [];
  private killLink: (() => void) | null = null;
  private statusCb: ((s: TransportStatus, d?: string) => void) | null = null;

  readonly deps: ReconnectDeps = {
    join: (_info, _doc, onStatus) => {
      this.joinCalls++;
      this.statusCb = onStatus;
      return new Promise<JoinedSession>((resolve, reject) => {
        this.pending.push({resolve, reject});
      });
    },
    setTimer: (fn, ms) => {
      this.timers.push({fn, ms});
      return this.timers.length - 1;
    },
    clearTimer: (h) => {
      const i = h as number;
      if (this.timers[i]) this.timers[i] = {fn: () => {}, ms: 0};
    },
    makeHeartbeat: (_session, onDead) => {
      this.killLink = onDead;
      return {
        stop: () => {
          this.heartbeatsStopped++;
        },
      };
    },
  };

  /** Complete the outstanding join successfully. */
  async succeedJoin(): Promise<void> {
    const p = this.pending.shift();
    if (!p) throw new Error('no pending join');
    const transport: Transport = {
      name: 'fake',
      send: async () => {},
      onReceive: () => {},
      onStatus: () => {},
      open: async () => {},
      close: async () => {},
    };
    p.resolve({
      info: INFO,
      transport,
      sync: {stop: () => {}} as never,
      leave: () => {
        this.left++;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
  }

  async failJoin(message = 'ECONNREFUSED'): Promise<void> {
    const p = this.pending.shift();
    if (!p) throw new Error('no pending join');
    p.reject(new Error(message));
    await Promise.resolve();
    await Promise.resolve();
  }

  /** Fire the scheduled retry, as a timer firing would. */
  async runPendingTimer(): Promise<void> {
    const t = this.timers.pop();
    if (!t) throw new Error('no pending timer');
    t.fn();
    await Promise.resolve();
  }

  lastDelay(): number {
    return this.timers[this.timers.length - 1]?.ms ?? -1;
  }

  /** Simulate the heartbeat declaring the link dead. */
  dropLink(): void {
    if (!this.killLink) throw new Error('no heartbeat attached');
    this.killLink();
  }

  /** Simulate the socket reporting closure. */
  reportStatus(status: TransportStatus, detail?: string): void {
    this.statusCb?.(status, detail);
  }
}

function start(h: Harness, opts = {}) {
  return keepSessionJoined(
    INFO,
    new Y.Doc(),
    {
      initialDelayMs: 1000,
      maxDelayMs: 8000,
      onStateChange: (s) => h.states.push(s),
      ...opts,
    },
    h.deps,
  );
}

describe('keepSessionJoined', () => {
  it('reports connected once the join succeeds', async () => {
    const h = new Harness();
    const session = start(h);

    expect(h.joinCalls).toBe(1);
    await h.succeedJoin();

    expect(session.state).toBe('connected');
    expect(session.attempts).toBe(0);
  });

  it('rejoins after the heartbeat declares the link dead', async () => {
    const h = new Harness();
    const session = start(h);
    await h.succeedJoin();

    h.dropLink();
    expect(session.state).toBe('reconnecting');
    // The dead connection is torn down rather than leaked.
    expect(h.left).toBe(1);
    expect(h.heartbeatsStopped).toBe(1);

    await h.runPendingTimer();
    await h.succeedJoin();

    expect(h.joinCalls).toBe(2);
    expect(session.state).toBe('connected');
  });

  it('rejoins when the socket closes under a live connection', async () => {
    const h = new Harness();
    const session = start(h);
    await h.succeedJoin();

    h.reportStatus('closed');

    expect(session.state).toBe('reconnecting');
    await h.runPendingTimer();
    await h.succeedJoin();
    expect(session.state).toBe('connected');
  });

  it('backs off exponentially, capped at maxDelayMs', async () => {
    const h = new Harness();
    start(h);

    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      await h.failJoin();
      delays.push(h.lastDelay());
      await h.runPendingTimer();
    }

    // 1s, 2s, 4s, 8s, then capped at 8s.
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('resets backoff after a successful rejoin', async () => {
    const h = new Harness();
    const session = start(h);

    await h.failJoin();
    await h.runPendingTimer();
    await h.failJoin();
    expect(h.lastDelay()).toBe(2000);

    await h.runPendingTimer();
    await h.succeedJoin();
    expect(session.attempts).toBe(0);

    // A later drop starts from the first delay again, not where it left off.
    h.dropLink();
    expect(h.lastDelay()).toBe(1000);
  });

  it('gives up after maxAttempts', async () => {
    const h = new Harness();
    const session = start(h, {maxAttempts: 2});

    await h.failJoin();
    await h.runPendingTimer();
    await h.failJoin();

    expect(session.state).toBe('stopped');
    expect(h.joinCalls).toBe(2);
  });

  it('stop() halts retrying and tears down the connection', async () => {
    const h = new Harness();
    const session = start(h);
    await h.succeedJoin();

    session.stop();

    expect(session.state).toBe('stopped');
    expect(h.left).toBe(1);
    expect(h.heartbeatsStopped).toBe(1);

    // A drop after stopping must not schedule anything.
    h.dropLink();
    expect(h.joinCalls).toBe(1);
  });

  it('leaves a session that arrives after stop() rather than leaking it', async () => {
    const h = new Harness();
    const session = start(h);

    session.stop();
    await h.succeedJoin(); // in-flight join lands late

    expect(h.left).toBeGreaterThanOrEqual(1);
    expect(session.state).toBe('stopped');
  });

  it('ignores a socket close reported while already reconnecting', async () => {
    const h = new Harness();
    start(h);
    await h.succeedJoin();

    h.dropLink();
    const callsAfterDrop = h.joinCalls;
    h.reportStatus('closed');
    h.reportStatus('error', 'boom');

    // Still exactly one retry scheduled, not three.
    expect(h.joinCalls).toBe(callsAfterDrop);
    await h.runPendingTimer();
    expect(h.joinCalls).toBe(callsAfterDrop + 1);
  });
});
