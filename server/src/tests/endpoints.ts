/**
 * Black-box endpoint suite. Runs against an already-listening server:
 *
 *   BASE=http://localhost:3000 WS=ws://localhost:1234 pnpm test:endpoints
 *
 * Covers every route in src/index.ts and the route files, plus the Hocuspocus
 * WebSocket auth and the tus upload flow. Uses fresh emails each run so it can
 * be re-run against the same database.
 */

import { createHash } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { tick, encodeHlc, type EditEntry } from "@fieldmesh/shared";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WS = process.env.WS ?? "ws://localhost:1234";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    const d = detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`;
    failures.push(`${name}${d}`);
    console.log(`  FAIL ${name}${d}`);
  }
}

function section(title: string) {
  console.log(`\n== ${title}`);
}

interface Res {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

async function call(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}
): Promise<Res> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = typeof opts.json === "string" ? opts.json : JSON.stringify(opts.json);
  } else if (opts.raw !== undefined) {
    body = opts.raw;
  }
  const r = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await r.text();
  let parsed: any = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: r.status, headers: r.headers, body: parsed, text };
}

function jwtPayload(token: string): any {
  const part = token.split(".")[1];
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

const PASSWORD = "correct horse battery";

async function signup(email: string, name: string, role?: string) {
  const r = await call("POST", "/auth/signup", { json: { email, name, password: PASSWORD, role } });
  if (r.status !== 201) throw new Error(`signup ${email} failed: ${r.status} ${r.text}`);
  return r.body as { token: string; user: any };
}

async function login(email: string, password = PASSWORD) {
  return call("POST", "/auth/login", { json: { email, password } });
}

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

function tusMeta(meta: Record<string, string>) {
  return Object.entries(meta)
    .map(([k, v]) => `${k} ${b64(v)}`)
    .join(",");
}

function connect(token: string, inspectionId: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: WS,
    name: `inspection:${inspectionId}`,
    token,
    document: doc,
    WebSocketPolyfill: WebSocket,
  } as any);
  const outcome = new Promise<"synced" | "denied">((resolve) => {
    provider.on("synced", () => resolve("synced"));
    provider.on("authenticationFailed", () => resolve("denied"));
  });
  return { doc, provider, outcome };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);
}

async function pollUntil<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 5000): Promise<T> {
  const start = Date.now();
  let last: T = await fn();
  while (!pred(last) && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
}

async function main() {
  const run = Date.now().toString(36);

  section("health");
  {
    const r = await call("GET", "/health");
    check("GET /health 200", r.status === 200 && r.body?.ok === true, r.body);
  }

  section("auth: signup");
  const emailA = `a-${run}@test.dev`;
  const emailB = `b-${run}@test.dev`;
  const emailC = `c-${run}@test.dev`;
  {
    const r = await call("POST", "/auth/signup");
    check("signup with no body -> 400 (not 500)", r.status === 400, r.status);
    const r1 = await call("POST", "/auth/signup", { json: { name: "x", password: PASSWORD } });
    check("signup without email -> 400", r1.status === 400, r1.status);
    const r2 = await call("POST", "/auth/signup", { json: { email: "not-an-email", name: "x", password: PASSWORD } });
    check("signup with invalid email -> 400", r2.status === 400, r2.status);
    const r3 = await call("POST", "/auth/signup", { json: { email: emailA, password: PASSWORD } });
    check("signup without name -> 400", r3.status === 400, r3.status);
    const r4 = await call("POST", "/auth/signup", { json: { email: emailA, name: "x" } });
    check("signup without password -> 400", r4.status === 400, r4.status);
    const r5 = await call("POST", "/auth/signup", { json: { email: emailA, name: "x", password: "short" } });
    check("signup with short password -> 400", r5.status === 400, r5.status);
    const r6 = await call("POST", "/auth/signup", { json: { email: emailA, name: "x", password: PASSWORD, role: "admin" } });
    check("signup with unknown role -> 400", r6.status === 400, r6.status);
    const r7 = await call("POST", "/auth/signup", { json: "{not json" });
    check("signup with malformed JSON -> 400", r7.status === 400, r7.status);
  }
  const A = await signup(emailA, "Athidh");
  const B = await signup(emailB, "Rogith", "supervisor");
  const C = await signup(emailC, "Stranger");
  check("signup returns token", typeof A.token === "string" && A.token.length > 20);
  check("signup user shape {id,name,email,role}", A.user && A.user.id && A.user.name === "Athidh" && A.user.email === emailA && A.user.role === "technician", A.user);
  check("signup response has no password_hash", !("password_hash" in (A.user ?? {})), Object.keys(A.user ?? {}));
  check("signup honours a chosen role", B.user?.role === "supervisor", B.user);
  check("signup token carries sub and role", jwtPayload(B.token).sub === B.user.id && jwtPayload(B.token).role === "supervisor", jwtPayload(B.token));
  {
    const r = await call("POST", "/auth/signup", { json: { email: emailA, name: "again", password: PASSWORD } });
    check("duplicate signup -> 409", r.status === 409, r.status);
    const r2 = await call("POST", "/auth/signup", { json: { email: emailA.toUpperCase(), name: "again", password: PASSWORD } });
    check("duplicate signup with different email case -> 409", r2.status === 409, r2.status);
  }

  section("auth: login");
  {
    const r = await call("POST", "/auth/login");
    check("login with no body -> 400 (not 500)", r.status === 400, r.status);
    const r1 = await call("POST", "/auth/login", { json: { password: PASSWORD } });
    check("login without email -> 400", r1.status === 400, r1.status);
    const r2 = await call("POST", "/auth/login", { json: { email: emailA } });
    check("login without password -> 400", r2.status === 400, r2.status);
    const r3 = await login(emailA, "wrong password");
    check("login with wrong password -> 401", r3.status === 401, r3.status);
    const r4 = await login(`nobody-${run}@test.dev`);
    check("login with unknown email -> 401", r4.status === 401, r4.status);
    check("unknown email and wrong password give the same error", r3.body?.error === r4.body?.error, [r3.body, r4.body]);
    const r5 = await login(emailA);
    check("login with correct password -> 200", r5.status === 200 && typeof r5.body?.token === "string", r5.status);
    check("login user matches signup user", JSON.stringify(r5.body?.user) === JSON.stringify(A.user), [r5.body?.user, A.user]);
    check("login response has no password_hash", !("password_hash" in (r5.body?.user ?? {})), Object.keys(r5.body?.user ?? {}));
    const r6 = await login(emailA.toUpperCase());
    check("login is case-insensitive on email", r6.status === 200, r6.status);
  }

  section("auth: refresh and me");
  {
    const r = await call("POST", "/auth/refresh");
    check("refresh without token -> 401", r.status === 401, r.status);
    const r2 = await call("POST", "/auth/refresh", { token: "garbage" });
    check("refresh with bad token -> 401", r2.status === 401, r2.status);
    const r3 = await call("POST", "/auth/refresh", { token: B.token });
    check("refresh -> 200 token", r3.status === 200 && typeof r3.body?.token === "string", r3.body);
    const p = r3.body?.token ? jwtPayload(r3.body.token) : {};
    check("refreshed token keeps sub", p.sub === B.user.id, p);
    check("refreshed token keeps role", p.role === "supervisor", p);
    const me = await call("GET", "/auth/me", { token: A.token });
    check("GET /auth/me -> own profile", me.status === 200 && me.body?.user?.id === A.user.id && me.body?.user?.email === emailA, me.body);
    const meNo = await call("GET", "/auth/me");
    check("GET /auth/me without token -> 401", meNo.status === 401, meNo.status);
  }

  section("teams");
  {
    const r = await call("GET", "/teams");
    check("GET /teams without token -> 401", r.status === 401, r.status);
  }
  {
    const r = await call("POST", "/teams", { token: A.token, json: {} });
    check("POST /teams without name -> 400 (not 500)", r.status === 400, r.status);
    const r2 = await call("POST", "/teams", { token: A.token });
    check("POST /teams with no body -> 400", r2.status === 400, r2.status);
  }
  const teamRes = await call("POST", "/teams", { token: A.token, json: { name: `Team ${run}` } });
  check("POST /teams -> {id}", teamRes.status === 200 && typeof teamRes.body?.id === "string", teamRes.body);
  const teamId = teamRes.body?.id as string;
  {
    const r = await call("GET", "/teams", { token: A.token });
    check("GET /teams lists created team for creator", r.status === 200 && Array.isArray(r.body) && r.body.some((t: any) => t.id === teamId && t.name === `Team ${run}`), r.body);
    const rc = await call("GET", "/teams", { token: C.token });
    check("GET /teams for stranger does not include it", rc.status === 200 && !rc.body.some((t: any) => t.id === teamId));
  }
  {
    const r = await call("POST", `/teams/${teamId}/members`, { token: A.token, json: {} });
    check("add member without userId -> 400 (not 404)", r.status === 400, r.status);
    const r2 = await call("POST", `/teams/${teamId}/members`, { token: A.token, json: { userId: "nope" } });
    check("add unknown user -> 404", r2.status === 404, r2.status);
    const r3 = await call("POST", `/teams/${teamId}/members`, { token: C.token, json: { userId: B.user.id } });
    check("non-member adding -> 403", r3.status === 403, r3.status);
    const r4 = await call("POST", `/teams/${teamId}/members`, { token: A.token, json: { userId: B.user.id } });
    check("member adds B -> 204", r4.status === 204, r4.status);
    const r5 = await call("POST", `/teams/${teamId}/members`, { token: A.token, json: { userId: B.user.id } });
    check("adding B again is idempotent -> 204", r5.status === 204, r5.status);
    const r6 = await call("POST", `/teams/does-not-exist/members`, { token: A.token, json: { userId: B.user.id } });
    check("add to unknown team -> 403/404", r6.status === 403 || r6.status === 404, r6.status);
    const rb = await call("GET", "/teams", { token: B.token });
    check("B now sees team", rb.body.some((t: any) => t.id === teamId));
  }

  section("inspections");
  {
    const r = await call("POST", "/inspections", { token: A.token, json: {} });
    check("POST /inspections without teamId -> 400", r.status === 400, r.status);
    const r2 = await call("POST", "/inspections", { token: A.token, json: { teamId } });
    check("POST /inspections without title -> 400 (not 500)", r2.status === 400, r2.status);
    const r3 = await call("POST", "/inspections", { token: C.token, json: { teamId, title: "x" } });
    check("stranger creating in team -> 403", r3.status === 403, r3.status);
    const r4 = await call("POST", "/inspections", { token: A.token, json: { teamId: "nope", title: "x" } });
    check("unknown team -> 403", r4.status === 403 || r4.status === 404, r4.status);
  }
  const inspRes = await call("POST", "/inspections", { token: A.token, json: { teamId, title: "Barn roof", site: "North field" } });
  check("POST /inspections -> {id}", inspRes.status === 200 && typeof inspRes.body?.id === "string", inspRes.body);
  const inspId = inspRes.body?.id as string;
  {
    const r = await call("GET", "/inspections", { token: B.token });
    check("GET /inspections: teammate sees it", r.status === 200 && r.body.some((i: any) => i.id === inspId), r.body);
    const rc = await call("GET", "/inspections", { token: C.token });
    check("GET /inspections: stranger does not", rc.status === 200 && !rc.body.some((i: any) => i.id === inspId));
    const one = await call("GET", `/inspections/${inspId}`, { token: A.token });
    check("GET /inspections/:id -> row", one.status === 200 && one.body?.title === "Barn roof" && one.body?.site === "North field" && one.body?.team_id === teamId && one.body?.created_by === A.user.id, one.body);
    const oneC = await call("GET", `/inspections/${inspId}`, { token: C.token });
    check("GET /inspections/:id stranger -> 403", oneC.status === 403, oneC.status);
    const none = await call("GET", `/inspections/does-not-exist`, { token: A.token });
    check("GET unknown inspection -> 404", none.status === 404, none.status);
    const noTok = await call("GET", `/inspections/${inspId}`);
    check("GET /inspections/:id without token -> 401", noTok.status === 401, noTok.status);
  }
  {
    const h = await call("GET", `/inspections/${inspId}/history`, { token: A.token });
    check("history empty at start", h.status === 200 && Array.isArray(h.body) && h.body.length === 0, h.body);
    const d = await call("GET", `/inspections/${inspId}/disputes`, { token: A.token });
    check("disputes empty at start", d.status === 200 && Array.isArray(d.body) && d.body.length === 0, d.body);
    const hc = await call("GET", `/inspections/${inspId}/history`, { token: C.token });
    check("history stranger -> 403", hc.status === 403, hc.status);
    const dc = await call("GET", `/inspections/${inspId}/disputes`, { token: C.token });
    check("disputes stranger -> 403", dc.status === 403, dc.status);
  }

  section("hocuspocus websocket auth");
  {
    const bad = connect("garbage", inspId);
    const out = await withTimeout(bad.outcome, 5000, "bad token ws");
    check("ws with bad token denied", out === "denied", out);
    bad.provider.destroy();
    const strangerConn = connect(C.token, inspId);
    const out2 = await withTimeout(strangerConn.outcome, 5000, "stranger ws");
    check("ws stranger denied", out2 === "denied", out2);
    strangerConn.provider.destroy();
    const wrongDoc = new HocuspocusProvider({
      url: WS,
      name: `whatever:${inspId}`,
      token: A.token,
      document: new Y.Doc(),
      WebSocketPolyfill: WebSocket,
    } as any);
    const out3 = await withTimeout(
      new Promise<string>((res) => {
        wrongDoc.on("synced", () => res("synced"));
        wrongDoc.on("authenticationFailed", () => res("denied"));
      }),
      5000,
      "wrong doc name ws"
    );
    check("ws with non-inspection doc name denied", out3 === "denied", out3);
    wrongDoc.destroy();
  }

  section("edits sync, dispute detection, resolve");
  const connA = connect(A.token, inspId);
  const connB = connect(B.token, inspId);
  check("ws member A synced", (await withTimeout(connA.outcome, 5000, "A ws")) === "synced");
  check("ws member B synced", (await withTimeout(connB.outcome, 5000, "B ws")) === "synced");

  // Concurrent: both branch from nothing (same parents) on "moisture".
  const base = { wall: Date.now(), counter: 0, node: "devA" };
  const eA: EditEntry = { id: `ea-${run}`, fieldId: "moisture", value: 41, author: A.user.id, device: "devA", hlc: encodeHlc(base), parents: [], schemaVersion: 1 };
  const eB: EditEntry = { id: `eb-${run}`, fieldId: "moisture", value: 58, author: B.user.id, device: "devB", hlc: encodeHlc(tick(base, "devB")), parents: [], schemaVersion: 1 };
  connA.doc.getMap("edits").set(eA.id, eA);
  connB.doc.getMap("edits").set(eB.id, eB);

  {
    const seenOnB = await pollUntil(async () => connB.doc.getMap("edits").has(eA.id), (v) => v === true);
    check("A's edit fans out to B over the server", seenOnB);
    const disputes = await pollUntil(
      () => call("GET", `/inspections/${inspId}/disputes`, { token: A.token }),
      (r) => Array.isArray(r.body) && r.body.length === 2
    );
    check("concurrent edits become 2 disputed rows", disputes.body?.length === 2, disputes.body);
    const ids = new Set((disputes.body ?? []).map((r: any) => r.edit_id));
    check("disputed rows are exactly the two edits", ids.has(eA.id) && ids.has(eB.id), [...ids]);
    const hist = await call("GET", `/inspections/${inspId}/history`, { token: B.token });
    check("history has both edits ordered by hlc", hist.body?.length === 2 && hist.body[0].edit_id === eA.id && hist.body[1].edit_id === eB.id, hist.body);
    check("history row stores parents as JSON", hist.body?.[0]?.parents === "[]", hist.body?.[0]?.parents);
  }

  // Sequential on another field: B's edit names A's as parent -> no dispute.
  {
    const s1: EditEntry = { id: `s1-${run}`, fieldId: "crop", value: "wheat", author: A.user.id, device: "devA", hlc: encodeHlc(tick(base, "devA")), parents: [], schemaVersion: 1 };
    connA.doc.getMap("edits").set(s1.id, s1);
    await pollUntil(async () => connB.doc.getMap("edits").has(s1.id), (v) => v === true);
    const s2: EditEntry = { id: `s2-${run}`, fieldId: "crop", value: "barley", author: B.user.id, device: "devB", hlc: encodeHlc(tick(tick(base, "devA"), "devB")), parents: [s1.id], schemaVersion: 1 };
    connB.doc.getMap("edits").set(s2.id, s2);
    const hist = await pollUntil(
      () => call("GET", `/inspections/${inspId}/history`, { token: A.token }),
      (r) => Array.isArray(r.body) && r.body.length === 4
    );
    check("sequential edits both persisted", hist.body?.length === 4, hist.body?.length);
    const disputes = await call("GET", `/inspections/${inspId}/disputes`, { token: A.token });
    check("sequential edits are not disputed", !disputes.body.some((r: any) => r.field_id === "crop"), disputes.body);
  }

  {
    const r = await call("POST", `/inspections/${inspId}/resolve`, { token: A.token, json: {} });
    check("resolve without fieldId -> 400", r.status === 400, r.status);
    const r2 = await call("POST", `/inspections/${inspId}/resolve`, { token: A.token, json: { fieldId: "crop", value: "x" } });
    check("resolve undisputed field -> 409", r2.status === 409, r2.status);
    const r3 = await call("POST", `/inspections/${inspId}/resolve`, { token: C.token, json: { fieldId: "moisture", value: 50 } });
    check("resolve by stranger -> 403", r3.status === 403, r3.status);

    const seen = new Promise<any>((resolve) => {
      connB.doc.getMap("edits").observe((ev) => {
        ev.changes.keys.forEach((_c, key) => {
          const v = connB.doc.getMap("edits").get(key) as any;
          if (v?.fieldId === "moisture" && v.parents?.length === 2) resolve(v);
        });
      });
    });
    const r4 = await call("POST", `/inspections/${inspId}/resolve`, { token: A.token, json: { fieldId: "moisture", value: 50, device: "supervisor" } });
    check("resolve -> {editId}", r4.status === 200 && typeof r4.body?.editId === "string", r4.body);
    const live = await withTimeout(seen, 5000, "resolution reaching B");
    check("resolution edit reaches live client with both parents", live.id === r4.body.editId && live.parents.includes(eA.id) && live.parents.includes(eB.id) && live.value === 50, live);
    const disputes = await pollUntil(
      () => call("GET", `/inspections/${inspId}/disputes`, { token: A.token }),
      (r) => Array.isArray(r.body) && r.body.length === 0
    );
    check("disputes cleared after resolve", disputes.body?.length === 0, disputes.body);
    const hist = await call("GET", `/inspections/${inspId}/history`, { token: A.token });
    check("history now has 5 edits incl. resolution", hist.body?.length === 5, hist.body?.length);
  }

  section("report");
  {
    const rc = await call("GET", `/inspections/${inspId}/report`, { token: C.token });
    check("report stranger -> 403", rc.status === 403, rc.status);
    const r = await call("GET", `/inspections/${inspId}/report`, { token: A.token });
    check("report -> 200", r.status === 200, r.status);
    check("report is implemented (no not_implemented stub)", r.body?.status !== "not_implemented", r.body);
    check("report carries inspection metadata", r.body?.inspection?.id === inspId && r.body?.inspection?.title === "Barn roof", r.body?.inspection);
    const fields = r.body?.fields ?? {};
    check("report: moisture resolved to 50", String(fields.moisture?.value) === "50" && fields.moisture?.disputed === false, fields.moisture);
    check("report: crop is latest sequential value", fields.crop?.value === "barley" && fields.crop?.disputed === false, fields.crop);
    check("report: edit count", r.body?.summary?.edits === 5, r.body?.summary);
    check("report: no open disputes", r.body?.summary?.disputedFields === 0, r.body?.summary);
  }

  section("photo upload (tus) and fetch");
  const photoBytes = Buffer.from(`fake-jpeg-${run}-` + "x".repeat(5000));
  const hash = createHash("sha256").update(photoBytes).digest("hex");
  {
    const r = await call("HEAD", `/photos/${hash}`, { token: A.token });
    check("HEAD unknown photo -> 404", r.status === 404, r.status);
    const rn = await call("HEAD", `/photos/${hash}`);
    check("HEAD without token -> 401", rn.status === 401, rn.status);
    const rg = await call("GET", `/photos/${hash}`, { token: A.token });
    check("GET unknown photo -> 404", rg.status === 404, rg.status);
  }
  {
    const r = await call("POST", "/uploads", {
      headers: { "Tus-Resumable": "1.0.0", "Upload-Length": String(photoBytes.length) },
    });
    check("tus create without token -> 401", r.status === 401, r.status);
  }
  async function tusUpload(claimedHash: string, meta: Record<string, string> = { hash: claimedHash, inspectionId: inspId, uploadedBy: A.user.id }) {
    const create = await call("POST", "/uploads", {
      token: A.token,
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(photoBytes.length),
        "Upload-Metadata": tusMeta(meta),
      },
    });
    const location = create.headers.get("location") ?? "";
    const path = location.replace(/^https?:\/\/[^/]+/, "");
    const patch = await call("PATCH", path, {
      token: A.token,
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Type": "application/offset+octet-stream",
      },
      raw: photoBytes,
    });
    return { create, path, patch };
  }
  {
    const { create, path, patch } = await tusUpload(hash);
    check("tus create -> 201 with Location", create.status === 201 && path.startsWith("/uploads/"), { status: create.status, path });
    check("tus PATCH full body -> 204", patch.status === 204, { status: patch.status, body: patch.text });
    check("tus PATCH reports final offset", patch.headers.get("upload-offset") === String(photoBytes.length), patch.headers.get("upload-offset"));
    const head = await call("HEAD", `/photos/${hash}`, { token: B.token });
    check("HEAD known photo -> 200", head.status === 200, head.status);
    const get = await fetch(`${BASE}/photos/${hash}`, { headers: { authorization: `Bearer ${B.token}` } });
    const got = Buffer.from(await get.arrayBuffer());
    check("GET photo -> bytes round-trip", get.status === 200 && got.equals(photoBytes), { status: get.status, len: got.length });
    check("GET photo is immutable-cacheable", (get.headers.get("cache-control") ?? "").includes("immutable"), get.headers.get("cache-control"));
    const again = await tusUpload(hash);
    check("re-uploading same hash is accepted (dedupe)", again.patch.status === 204, again.patch.status);
  }
  {
    const wrong = "0".repeat(64);
    const { patch } = await tusUpload(wrong);
    check("hash mismatch -> 460", patch.status === 460, { status: patch.status, body: patch.text });
    const head = await call("HEAD", `/photos/${wrong}`, { token: A.token });
    check("mismatched photo not recorded", head.status === 404, head.status);
  }
  {
    const { patch } = await tusUpload("deadbeef", { hash: "deadbeef" });
    check("missing metadata -> 400", patch.status === 400, { status: patch.status, body: patch.text });
  }
  {
    // Resume: send the first half, then HEAD for the offset, then the rest.
    const bytes2 = Buffer.from(`resume-${run}-` + "y".repeat(8000));
    const hash2 = createHash("sha256").update(bytes2).digest("hex");
    const create = await call("POST", "/uploads", {
      token: A.token,
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(bytes2.length),
        "Upload-Metadata": tusMeta({ hash: hash2, inspectionId: inspId, uploadedBy: A.user.id }),
      },
    });
    const path = (create.headers.get("location") ?? "").replace(/^https?:\/\/[^/]+/, "");
    const half = Math.floor(bytes2.length / 2);
    const p1 = await call("PATCH", path, {
      token: A.token,
      headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
      raw: bytes2.subarray(0, half),
    });
    check("partial PATCH -> 204", p1.status === 204, p1.status);
    const h = await call("HEAD", path, { token: A.token, headers: { "Tus-Resumable": "1.0.0" } });
    check("tus HEAD reports partial offset", h.headers.get("upload-offset") === String(half), h.headers.get("upload-offset"));
    const p2 = await call("PATCH", path, {
      token: A.token,
      headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": String(half), "Content-Type": "application/offset+octet-stream" },
      raw: bytes2.subarray(half),
    });
    check("resumed PATCH completes -> 204", p2.status === 204, { status: p2.status, body: p2.text });
    const head = await call("HEAD", `/photos/${hash2}`, { token: A.token });
    check("resumed photo recorded", head.status === 200, head.status);
    const rep = await call("GET", `/inspections/${inspId}/report`, { token: A.token });
    check("report lists uploaded photos", Array.isArray(rep.body?.photos) && rep.body.photos.some((p: any) => p.hash === hash2), rep.body?.photos);
  }

  connA.provider.destroy();
  connB.provider.destroy();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("suite crashed:", err);
  process.exit(2);
});
