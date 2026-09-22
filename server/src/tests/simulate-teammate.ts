/**
 * Simulates a second phone editing an inspection offline, to demo dispute
 * detection end-to-end against a running server:
 *
 *   BASE=http://localhost:3000 WS=ws://localhost:1234 \
 *   EMAIL=priya@test.dev NAME=Priya INSPECTION=<id> \
 *   FIELD=insulation_condition VALUE=fail pnpm tsx src/tests/simulate-teammate.ts
 *
 * Steps: sign up / log in as EMAIL (prints the user id so a teammate can add it
 * to the team), connect to the inspection's Hocuspocus document, wait for
 * sync, then write an edit that names the SAME parents as the current head —
 * i.e. an edit made without having seen the latest change — which is exactly
 * what the server flags as a dispute. With ACTION=list it only prints the
 * user id and the inspections visible to it; with ACTION=watch it stays
 * connected and prints every edit that arrives (e.g. the resolution).
 */
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { tick, encodeHlc, decodeHlc, compare, type EditEntry } from "@fieldmesh/shared";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WS = process.env.WS ?? "ws://localhost:1234";
const EMAIL = process.env.EMAIL ?? "priya@test.dev";
const NAME = process.env.NAME ?? "Priya";
const PASSWORD = process.env.PASSWORD ?? "fieldsecret4091";
const ROLE = process.env.ROLE ?? "technician";
const ACTION = process.env.ACTION ?? "edit";
const FIELD = process.env.FIELD ?? "insulation_condition";
const RAW_VALUE = process.env.VALUE ?? "fail";
const DEVICE = process.env.DEVICE ?? "galaxy-xcover-sim";

async function call(method: string, path: string, token?: string, json?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (json !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const text = await r.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

async function auth(): Promise<{ token: string; user: any }> {
  const login = await call("POST", "/auth/login", undefined, { email: EMAIL, password: PASSWORD });
  if (login.status === 200) return login.body;
  const signup = await call("POST", "/auth/signup", undefined, { email: EMAIL, name: NAME, password: PASSWORD, role: ROLE });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
  return signup.body;
}

function parseValue(raw: string): unknown {
  if (raw === "pass" || raw === "fail") return raw;
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
}

async function main() {
  const { token, user } = await auth();
  console.log(`user: ${user.name} <${user.email}> role=${user.role}`);
  console.log(`USER_ID=${user.id}`);

  const inspections = (await call("GET", "/inspections", token)).body as any[];
  console.log(`inspections visible: ${inspections.length}`);
  for (const i of inspections) console.log(`  - ${i.id}  ${i.title}  (team ${i.team_id})`);
  if (ACTION === "list") return;

  const inspectionId = process.env.INSPECTION ?? inspections[0]?.id;
  if (!inspectionId) throw new Error("no inspection: add this user to the team first (POST /teams/:id/members)");

  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: WS,
    name: `inspection:${inspectionId}`,
    token,
    document: doc,
    WebSocketPolyfill: WebSocket,
  } as any);
  const synced = new Promise<void>((resolve, reject) => {
    provider.on("synced", () => resolve());
    provider.on("authenticationFailed", () => reject(new Error("ws auth failed (not a team member?)")));
    setTimeout(() => reject(new Error("ws sync timeout")), 10000);
  });
  await synced;
  provider.setAwarenessField("user", { id: user.id, name: user.name, role: user.role, device: DEVICE });
  const edits = doc.getMap("edits");
  console.log(`synced: ${edits.size} edits in document`);

  const entriesFor = (fieldId: string) =>
    [...edits.values()].filter((v: any) => v && v.fieldId === fieldId) as EditEntry[];
  const headsFor = (fieldId: string) => {
    const list = entriesFor(fieldId);
    const superseded = new Set(list.flatMap((e) => e.parents ?? []));
    return list.filter((e) => !superseded.has(e.id));
  };

  if (ACTION === "watch") {
    console.log("watching for edits (ctrl-c to stop)...");
    edits.observe((ev) => {
      ev.changes.keys.forEach((_c, key) => {
        const v = edits.get(key) as any;
        console.log(`  edit ${v?.fieldId} = ${JSON.stringify(v?.value)} by ${v?.author} device=${v?.device} parents=${JSON.stringify(v?.parents)}`);
      });
    });
    await new Promise(() => {});
    return;
  }

  const heads = headsFor(FIELD);
  const latest = heads.sort((a, b) => compare(decodeHlc(a.hlc), decodeHlc(b.hlc)))[heads.length - 1];
  // Fork from the same parents as the current head → concurrent with it.
  const parents = latest ? latest.parents : [];
  const base = latest ? decodeHlc(latest.hlc) : null;
  const entry: EditEntry = {
    id: `sim-${Date.now().toString(36)}`,
    fieldId: FIELD,
    value: parseValue(RAW_VALUE),
    author: user.id,
    device: DEVICE,
    hlc: encodeHlc(tick(base, DEVICE)),
    parents,
    schemaVersion: 1,
  };
  doc.transact(() => {
    edits.set(entry.id, entry);
    doc.getMap("fields").set(FIELD, entry.value);
  });
  console.log(`wrote concurrent edit on ${FIELD}: ${JSON.stringify(entry.value)} parents=${JSON.stringify(parents)} (head was ${latest ? JSON.stringify(latest.value) : "none"})`);

  // Give the server a moment to extract + recompute, then show what it thinks.
  await new Promise((r) => setTimeout(r, 1500));
  const disputes = (await call("GET", `/inspections/${inspectionId}/disputes`, token)).body as any[];
  console.log(`server disputes now: ${disputes.length} → fields ${[...new Set(disputes.map((d) => d.field_id))].join(", ") || "(none)"}`);
  provider.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("simulate-teammate failed:", e.message ?? e);
  process.exit(1);
});
