# FieldMesh Backend — TODO

Rogith's lane: cloud, merge engine, storage. 17 hours, MVP tasks first, stretch last so it can be cut without breaking the demo. Source: `FieldMesh_Backend_Work_Split.docx`. Athidh's lane (local hotspot/hub/chain relay) is listed at the bottom for coordination — it lives in the mobile app repo, not here.

## Hour 0–1 (together, before either lane starts)
- [x] Agree the shared edit format: `id, fieldId, value, author, device, hlc, parents, schemaVersion` — matches `shared/src/editlog/types.ts`
- [ ] Agree one transport interface (`send(bytes)`, `onReceive(bytes)`, `onStatus()`) that both lanes plug into
- [ ] One dev build with every native library added on day one, so rebuilds stay rare *(mobile repo)*

## Rogith — Cloud Backend, Merge Engine, Storage (17h)

### 1–3 · Server setup — MVP
- [x] Fastify server boots (`server/src/index.ts`)
- [x] Hocuspocus listening on :1234 (`server/src/sync/hocuspocus.ts`)
- [x] SQLite wired via better-sqlite3, schema applied on boot (`server/src/db/index.ts`, `schema.sql`)
- [x] `pnpm build` now actually produces a runnable `dist/` — `schema.sql` wasn't being copied over, so `pnpm start` crashed with `ENOENT`. Fixed in the `build` script.
- [ ] **Run everything under Node 20, not whatever's on PATH by default.** This machine has no VS Build Tools and no Node-24 prebuild for `better-sqlite3` — `pnpm install`/`dev`/`build` will hard-crash under Node 24. Confirmed working under Node 20 (matches `.nvmrc`). Check this on the actual demo machine too, don't assume.
- [ ] Docker Compose actually used for something real — currently spins up Postgres + MinIO, but the server code only ever talks to SQLite. Either wire Postgres in for real or drop that service from `docker-compose.yml` so it's not misleading.

### 3–5 · Auth, teams, inspections API — MVP
- [x] JWT issuing on login (`auth/routes.ts`)
- [ ] Real password check — right now any email logs in and auto-creates a user with `password_hash = "placeholder"`. Decide: is passwordless-by-design fine for the demo (then say so out loud, don't leave it looking like a bug), or add a real check?
- [ ] Apply `{ onRequest: [app.authenticate] }` to every route that should require login — currently only `/auth/refresh` is guarded. `inspections`, `photos`, `reports` are all wide open.
- [ ] Team-scoped queries — `GET /inspections` returns every team's inspections to anyone; needs a team-membership check against `team_members`
- [ ] Teams API — no create-team / add-member endpoints exist yet, despite `teams` and `team_members` tables being in the schema

### 5–8 · Edit log: HLC, parents, per-field rules, dispute detection — MVP
- [x] HLC tick/merge/compare (`shared/src/editlog/hlc.ts`) — verified correct against the standard algorithm
- [x] Per-field merge rules (`shared/src/editlog/rules.ts`) — pass_fail, numeric, notes, photo, short_text all implemented
- [ ] **Fix the `notes` case in `rules.ts`** — it does `edits.map(e => String(e.value)).join("")`, concatenating whole values instead of character-merging. Only acceptable if this function is never called for `notes` (Yjs `Y.Text` should merge that field directly); confirm which one is actually true and fix or document it.
- [ ] Implement `server/src/edits/extract.ts` — walk new Yjs updates, `INSERT OR IGNORE` into `edits`
- [ ] Implement `server/src/edits/disputes.ts` — for each changed field, gather concurrent edits (edits whose HLC-ordered "heads" have no parent relationship), run `mergeConcurrent()`, set the `disputed` flag

### 8–9.5 · On-device SQLite: Yjs updates, photo queue — MVP
- [ ] This is client-side (mobile repo) but the schema/shape should be agreed here since server and app both touch the same edit format

### 9.5–11 · Server persistence hooks — MVP — **the actual blocker for everything below**
- [x] Implement `server/src/sync/persist.ts`:
  - `onLoadDocument` — load the latest `yjs_documents` snapshot, apply any newer rows from `yjs_updates`
  - `onChange` — append the incoming update to `yjs_updates`, then call `extract.ts` (call site ready for extract.ts)
  - `onStoreDocument` (debounced) — write a compacted snapshot back to `yjs_documents` and prune folded updates
- [x] Wire real JWT verification into `hocuspocus.ts`'s `onAuthenticate` — verify token via Fastify's `@fastify/jwt`, enforce `inspection:<inspectionId>` naming, check team membership against SQLite `team_members`

### 11–13.5 · Photo hashing, tus upload, hash verify, MinIO — MVP
- [ ] Implement `server/src/photos/tus.ts` with `@tus/server` + `@tus/file-store` (or S3 store against `storage.ts`'s client, which exists but is currently unused)
- [ ] Mount the tus handler on `/uploads` in `index.ts` — not registered yet
- [ ] On upload completion: recompute SHA-256, reject mismatches, `INSERT` into `photos`
- [ ] Make `GET /photos/:hash` actually serve/redirect to the file — right now it only returns `{ storageKey }` as JSON

### 13.5–15 · History, disputes, resolve APIs — MVP
- [x] `GET /inspections/:id/history` — implemented, but will return `[]` until `extract.ts` is done
- [x] `GET /inspections/:id/disputes` — implemented, same dependency
- [ ] `POST /inspections/:id/resolve` — doesn't exist yet. Should write a new edit whose `parents` are all current disputed heads, closing the dispute (per the design doc's "supervisor resolution" behavior)

### 15–16.5 · Cloud deploy, merge correctness test — MVP
- [ ] Deploy to Render/Railway/Fly for the real-internet leg of the demo
- [ ] Merge correctness test script: many Yjs clients, random edits, random order, random disconnects, assert all converge identical

### 16.5–18 · Schema lens v1→v2 — Stretch
- [x] `shared/src/lenses/index.ts` — forward/backward chain walker, correctly implemented
- [x] `shared/src/lenses/v1_to_v2.ts` scaffolded
- [ ] **Fix the bug**: `backward()` returns `n.value` on both branches of its ternary — unit conversion never actually happens. Needs real conversion logic (e.g. mV → V) before this is demo-safe.

### Cleanup
- [ ] Delete or repurpose `server/src/sync/signaling.ts` — it's an empty stub for WebRTC re-pairing signaling, which is dead now that local sync uses native mDNS instead of WebRTC+QR
- [ ] `server/src/inspections/service.ts` is an empty placeholder — fold into `routes.ts` or delete if unused

---

## Athidh — Hotspot, Local Hub, Chain Relay (17h) — *mobile repo, tracked here for context*
- [ ] 1–2.5 Transport layer: message framing, Yjs state vector sync over any byte channel — MVP
- [ ] 2.5–4.5 Kotlin module: local-only hotspot, permissions, dev build — MVP
- [ ] 4.5–7 TCP hub (`react-native-tcp-socket`): session key check, sync, broadcast to spokes — MVP
- [ ] 7–8 Site session: Wi-Fi QR + session QR, join flow — MVP
- [ ] 8–9.5 Heartbeat, auto reconnect, keep-awake, foreground service — MVP
- [ ] 9.5–11.5 Photo chunks over TCP with resume — MVP
- [ ] 11.5–14.5 Nearby Connections module, chain relay forwarding — MVP
- [ ] 14.5–16 QR-frame fallback transport — Stretch
- [ ] 16–18 Real device testing: hotspot, bridge phone, Bluetooth fallback — MVP
