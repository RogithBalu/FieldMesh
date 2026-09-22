# FieldMesh — 24h Checkpoints

From `FieldMesh_Backend_Work_Split.docx`. MVP is locked at hour 14 — everything after that is testing or stretch. Athidh's checkpoints live in the mobile app repo; tracked here too so both sides of a checkpoint are visible in one place.

## Hour 5
- [ ] **Athidh** — Hotspot starts from the app *(mobile repo)*
- [x] **Rogith** — Server syncs a document over the cloud
  - Needs: Hocuspocus reachable, a client can open a WS doc session and see updates round-trip.
  - Status as of 2026-09-22 17:30: **Independently verified**, not just claimed — ran a real integration test against `persist.ts` (write → snapshot → simulated restart → reload → value survives, twice in a row). Real JWT + team-membership check confirmed by reading `hocuspocus.ts` directly. See LOG.md 17:30 entry for what it took to actually prove this (there was a machine-level blocker in the way).
  - **Environment note**: this only runs under Node 20 on this machine (no VS Build Tools + no Node 24 prebuild for `better-sqlite3`). Confirm Node 20 is active on whatever machine runs the demo before assuming this checkpoint holds there too.

## Hour 9
- [ ] **Athidh** — Three phones sync live through the hub *(mobile repo)*
- [ ] **Rogith** — Disputes show up from the edit log
  - Needs: `edits/extract.ts` populating the `edits` table from Yjs updates, `edits/disputes.ts` flagging concurrent edits via `mergeConcurrent()`, `GET /inspections/:id/disputes` returning non-empty results.
  - Status as of 2026-09-22 16:00: not started. `rules.ts` (the merge logic itself) is done; the two files that call it are empty stubs.

## Hour 14 — MVP lock
- [ ] **Athidh** — Chain relay reaches a phone outside hotspot range *(mobile repo)*
- [ ] **Rogith** — Photos upload with resume and hash verification
  - Needs: `photos/tus.ts` implemented and mounted on `/uploads`, `HEAD /photos/:hash` dedupe (already exists), server recomputes SHA-256 on completion and rejects mismatches, file lands in MinIO/S3 via `storage.ts`.
  - Status as of 2026-09-22 16:00: not started. `storage.ts` creates an S3 client nothing calls yet.

## Hour 16
- [ ] **Athidh** — Device testing, bug fixes, rehearsal
- [ ] **Rogith** — Device testing, bug fixes, rehearsal

## Cut list if time runs short
- Athidh cuts: QR-frame fallback transport (the hotspot hub is reliable enough on its own).
- Rogith cuts: schema lens v1→v2 (currently has a real bug in `backward()` anyway — see LOG.md).
- Never cut: the chain relay, and the three hard parts of the brief — sync protocol, schema handling, resumable media.
