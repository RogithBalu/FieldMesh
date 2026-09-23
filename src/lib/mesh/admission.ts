/**
 * Asking to join a hosted site session, over the mesh.
 *
 * Scanning the host's QR is the direct route, but it needs the two phones in
 * the same place. A phone that is only reachable through other phones sends a
 * JOIN_REQUEST instead: every linked peer forwards it once, so it walks the
 * mesh until it reaches the host. The host's answer walks back along the path
 * the request came in on, and a grant carries the session credentials with it.
 *
 * Forwarding is deliberately dumb — flood once, drop duplicates, decrement a
 * hop budget. Yjs updates can rely on idempotency to kill loops; these frames
 * cannot, so they carry a request id and every phone remembers the ids it has
 * already passed on.
 *
 * On key exposure: a grant carries the session key, and only phones already in
 * the mesh forward it. They are members of the session document already, so a
 * relay learns nothing it could not read anyway. A relay could forge a grant,
 * but a relay could equally just hand over the key it already holds, so the
 * forgery buys nothing. This is admission control, not defence against a
 * malicious member.
 */
import type { SessionInfo } from './qr';

/** Hops a request may still travel. Six is far more than a site ever needs. */
const DEFAULT_TTL = 6;
/** Ids remembered so a flooded frame is forwarded once. */
const SEEN_LIMIT = 256;
/** A request nobody answered is dropped from the host's queue after this. */
export const REQUEST_TTL_MS = 5 * 60 * 1000;

export interface JoinRequest {
  /** Request id — also what the decision is matched against. */
  rid: string;
  userId: string;
  name: string;
  role?: string;
  deviceId: string;
  /** Session asked for, e.g. "inspection:abc123". */
  doc: string;
  /** Hops travelled so far; shown to the approver as a distance hint. */
  hops: number;
  /** Hops remaining. */
  ttl: number;
  /** When this phone first saw it. */
  seenAt: number;
}

export interface JoinDecision {
  rid: string;
  /** Requester, so a phone can tell its own answer from one it is relaying. */
  userId: string;
  granted: boolean;
  /** Who decided, for the requester's confirmation message. */
  by?: string;
  reason?: string;
  /** Present only on a grant. */
  session?: SessionInfo;
  ttl: number;
}

/** What a phone does with a frame it has just decoded. */
export type AdmissionAction =
  | { kind: 'ignore' }
  /** We are the host: put it in front of the approver. */
  | { kind: 'queue'; request: JoinRequest }
  /** Not for us: pass it on, excluding the link it arrived on. */
  | { kind: 'forward'; exclude: string | null }
  /** Send it back the way the request came. */
  | { kind: 'route'; to: string }
  /** Our own request was answered. */
  | { kind: 'resolved'; decision: JoinDecision };

export interface AdmissionState {
  /** Requests waiting on this phone's approval (host only). */
  pending: JoinRequest[];
  /** Our own outstanding request, if we asked to join. */
  outstanding: { rid: string; doc: string; sentAt: number } | null;
  /** The answer to our own request, once it arrives. */
  lastDecision: JoinDecision | null;
}

const listeners = new Set<() => void>();
let state: AdmissionState = { pending: [], outstanding: null, lastDecision: null };

/** rid → the link a request arrived on, so its decision can be routed back. */
const returnRoutes = new Map<string, string>();
/** Frame ids already forwarded, newest last. */
const seen: string[] = [];
const seenSet = new Set<string>();

export function getAdmissionState(): AdmissionState {
  return state;
}

export function subscribeAdmission(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setState(patch: Partial<AdmissionState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function markSeen(id: string): boolean {
  if (seenSet.has(id)) return false;
  seenSet.add(id);
  seen.push(id);
  while (seen.length > SEEN_LIMIT) {
    const old = seen.shift();
    if (old) seenSet.delete(old);
  }
  return true;
}

/** Clears everything for a session that has ended. */
export function resetAdmission(): void {
  returnRoutes.clear();
  seen.length = 0;
  seenSet.clear();
  state = { pending: [], outstanding: null, lastDecision: null };
  listeners.forEach((l) => l());
}

export function newRequestId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds our own request and records it as outstanding. The caller floods it
 * to every link.
 */
export function beginRequest(input: {
  userId: string;
  name: string;
  role?: string;
  deviceId: string;
  doc: string;
}): JoinRequest {
  const request: JoinRequest = {
    rid: newRequestId(),
    userId: input.userId,
    name: input.name,
    role: input.role,
    deviceId: input.deviceId,
    doc: input.doc,
    hops: 0,
    ttl: DEFAULT_TTL,
    seenAt: Date.now(),
  };
  // Our own id counts as seen, so an echo from a neighbour is not re-flooded.
  markSeen(request.rid);
  setState({ outstanding: { rid: request.rid, doc: input.doc, sentAt: Date.now() }, lastDecision: null });
  return request;
}

export function cancelOutstanding(): void {
  setState({ outstanding: null });
}

/**
 * Decides what to do with an arriving JOIN_REQUEST.
 *
 * `isHost` is true on the phone hosting the session the request names, which
 * is the only phone that can answer it.
 */
export function receiveRequest(
  raw: unknown,
  fromLinkId: string,
  ctx: { isHost: boolean; hostedDoc: string | null; myUserId: string | null }
): AdmissionAction {
  const req = parseRequest(raw);
  if (!req) return { kind: 'ignore' };
  // Our own request coming back around, or one already passed on.
  if (req.userId === ctx.myUserId) return { kind: 'ignore' };
  if (!markSeen(req.rid)) return { kind: 'ignore' };

  returnRoutes.set(req.rid, fromLinkId);

  if (ctx.isHost && ctx.hostedDoc === req.doc) {
    pruneExpired();
    if (!state.pending.some((p) => p.rid === req.rid)) {
      // One live request per person: a phone that retried should replace its
      // earlier ask rather than queue twice in front of the approver.
      const withoutSameUser = state.pending.filter((p) => p.userId !== req.userId);
      setState({ pending: [...withoutSameUser, { ...req, seenAt: Date.now() }] });
    }
    return { kind: 'queue', request: req };
  }

  if (req.ttl <= 0) return { kind: 'ignore' };
  return { kind: 'forward', exclude: fromLinkId };
}

export function receiveDecision(
  raw: unknown,
  ctx: { myUserId: string | null }
): AdmissionAction {
  const dec = parseDecision(raw);
  if (!dec) return { kind: 'ignore' };
  if (!markSeen(`d:${dec.rid}`)) return { kind: 'ignore' };

  if (dec.userId === ctx.myUserId) {
    setState({
      lastDecision: dec,
      outstanding: state.outstanding?.rid === dec.rid ? null : state.outstanding,
    });
    return { kind: 'resolved', decision: dec };
  }

  if (dec.ttl <= 0) return { kind: 'ignore' };
  const route = returnRoutes.get(dec.rid);
  returnRoutes.delete(dec.rid);
  // Without a recorded route the decision still floods: the requester may have
  // re-linked through a different neighbour since it asked.
  return route ? { kind: 'route', to: route } : { kind: 'forward', exclude: null };
}

/** Removes a request from the host's queue and builds the answer to send. */
export function decide(
  rid: string,
  granted: boolean,
  by: string,
  session?: SessionInfo,
  reason?: string
): { decision: JoinDecision; route: string | null } | null {
  const request = state.pending.find((p) => p.rid === rid);
  if (!request) return null;
  setState({ pending: state.pending.filter((p) => p.rid !== rid) });
  const route = returnRoutes.get(rid) ?? null;
  returnRoutes.delete(rid);
  markSeen(`d:${rid}`);
  return {
    decision: {
      rid,
      userId: request.userId,
      granted,
      by,
      reason,
      session: granted ? session : undefined,
      ttl: DEFAULT_TTL,
    },
    route,
  };
}

/** Drops requests nobody acted on, so a stale queue does not pile up. */
export function pruneExpired(): void {
  const cutoff = Date.now() - REQUEST_TTL_MS;
  const live = state.pending.filter((p) => p.seenAt >= cutoff);
  if (live.length !== state.pending.length) setState({ pending: live });
}

/** A request being passed on: one hop further, one hop less to live. */
export function relayed(req: JoinRequest): JoinRequest {
  return { ...req, hops: req.hops + 1, ttl: req.ttl - 1 };
}

export function relayedDecision(dec: JoinDecision): JoinDecision {
  return { ...dec, ttl: dec.ttl - 1 };
}

// ── validation ───────────────────────────────────────────────────────────────
// Everything here arrived from another phone, so nothing is trusted: a frame
// with a missing or wrong-typed field is dropped rather than half-read.

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

function parseRequest(raw: unknown): JoinRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rid = str(o.rid, 64);
  const userId = str(o.u, 128);
  const name = str(o.n, 64);
  const deviceId = str(o.d, 128);
  const doc = str(o.doc, 256);
  if (!rid || !userId || !name || !deviceId || !doc) return null;
  const ttl = typeof o.t === 'number' && o.t >= 0 && o.t <= DEFAULT_TTL ? o.t : 0;
  const hops = typeof o.h === 'number' && o.h >= 0 && o.h <= DEFAULT_TTL ? o.h : 0;
  return { rid, userId, name, role: str(o.r, 32), deviceId, doc, ttl, hops, seenAt: Date.now() };
}

function parseDecision(raw: unknown): JoinDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const rid = str(o.rid, 64);
  const userId = str(o.u, 128);
  if (!rid || !userId || typeof o.ok !== 'boolean') return null;
  const ttl = typeof o.t === 'number' && o.t >= 0 && o.t <= DEFAULT_TTL ? o.t : 0;
  return {
    rid,
    userId,
    granted: o.ok,
    by: str(o.by, 64),
    reason: str(o.why, 200),
    session: o.ok ? (o.s as SessionInfo | undefined) : undefined,
    ttl,
  };
}

/** Wire form: short keys, because Nearby caps a payload at ~32 KB. */
export function encodeRequest(r: JoinRequest): string {
  return JSON.stringify({ rid: r.rid, u: r.userId, n: r.name, r: r.role, d: r.deviceId, doc: r.doc, h: r.hops, t: r.ttl });
}

export function encodeDecision(d: JoinDecision): string {
  return JSON.stringify({ rid: d.rid, u: d.userId, ok: d.granted, by: d.by, why: d.reason, s: d.session, t: d.ttl });
}
