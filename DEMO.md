# FieldMesh — jury demo script

Offline-first field inspections: every phone keeps working without signal, and when devices reconnect the server merges their edits, detects conflicting safety verdicts, and makes a lead resolve them on an audit trail.

## Setup (do this before the demo, ~20 minutes)

1. **Backend on AWS Lightsail** — the instance must run the current code (the one that passes `pnpm test:endpoints`). From the `Backend` folder on your laptop:
   ```bash
   set -a && source .env && set +a && ./scripts/redeploy-lightsail.sh
   curl http://98.80.162.7:3000/health
   cd server && BASE=http://98.80.162.7:3000 WS=ws://98.80.162.7:1234 pnpm test:endpoints
   ```
   Expect `107 passed, 0 failed`.
2. **Get the app onto two or three phones** (pick one):
   - *Fastest, no build:* install Expo Go from the Play Store on each phone, then on the laptop run `cd frontend && npx expo start --tunnel` and scan the QR code from each phone. The app talks to Lightsail; the phones only need internet.
   - *Real installable APK (cloud build, no laptop CPU):* `cd frontend && npx eas-cli login && npx eas-cli init && npx eas-cli build -p android --profile preview`. When it finishes, expo.dev shows a download link + QR; open it on each phone and allow "install from unknown sources". Any Android 8+ phone works.
   - *Local APK (slow on a small laptop):* `cd frontend && npx expo prebuild -p android && cd android && ./gradlew assembleRelease` with a JDK 17 and the Android SDK; the APK lands in `android/app/build/outputs/apk/release/`.
3. **Accounts** — on phone A sign up as a *Technician* (e.g. Arun). On phone B sign up as a *Supervisor* (e.g. Priya). On phone A: Teams → create "North Grid Crew" → tap the team → paste Priya's operator ID (she copies it from her Teams screen) → add. Both phones now see the same inspections.
4. **One inspection ready** — on phone A: New inspection → "Transformer Safety Inspection", site "North Grid Substation, Bay 2". Open it once on both phones so both have it cached.
5. Keep a laptop with the `Backend/server` folder handy; `pnpm test:teammate` can play a third technician if you only have two phones.

## The 6-minute story

1. **Login + presence (30 s)** — both phones open the same inspection. Point at the header: "Live · 2 on site". Tap the "On site" badge → Site Session shows who is editing right now, the REST and WebSocket endpoints, and the operator/device IDs.
2. **Live collaboration (45 s)** — phone A sets Insulation Condition = PASS and types 74 °C. Phone B sees the values appear within a second. Phone B adds a photo (camera) → "Verified on server": the app hashes the file with SHA-256, the server re-hashes what it received and rejects mismatches.
3. **Go offline (60 s)** — put phone B in airplane mode. Both keep editing: A changes the temperature to 79 (still within the ±10 °C tolerance), B changes Insulation to FAIL and the temperature to 95. Show B's badge "Saved on phone · 2 pending". Every edit is stored on-device first.
4. **Reconnect → disputes (60 s)** — airplane mode off. Within seconds both phones show "2 items need review": Insulation (PASS vs FAIL) and Oil Temperature (79 vs 95, outside tolerance). Explain: each edit carries a hybrid logical clock and the ids of the entries it saw; two entries with the same parents were made blind to each other, so the server flags them instead of silently picking one. Note the 74→79 change was *not* a dispute — the tolerance rule absorbed it.
5. **Human-in-the-loop (60 s)** — on the supervisor's phone tap Resolve on Insulation. The screen shows both entries side by side; the merge rule defaulted to FAIL for safety. Confirm FAIL (or override to PASS with a mandatory justification). Resolve the temperature by picking 79. Both phones clear the dispute instantly — the resolution is one signed edit naming both conflicting entries as parents.
6. **Audit + report (45 s)** — open the audit trail (clock icon): every edit, who, which device, what it superseded, flagged rows. Then "View Report & Sign Off": the server-generated report — 0 disputed, verified photos with hashes, resolution notes.
7. **Offline launch (30 s, optional)** — force-close the app on airplane mode and reopen: session, inspection list and checklist all load from the phone; the badge says "Saved on phone", and everything syncs when signal returns.

## If something goes wrong on stage

- Health pill on the login screen red → laptop hotspot + local server: run `pnpm dev:server` in `Backend`, then in the app tap the pill → "Join another session" → enter the laptop's IP → Test → Use this server.
- Only one phone available → run the teammate simulator from the laptop to create the conflicting edits:
  `cd Backend/server && BASE=http://98.80.162.7:3000 WS=ws://98.80.162.7:1234 EMAIL=priya@test.dev INSPECTION=<id> FIELD=insulation_condition VALUE=fail pnpm test:teammate` (the inspection id is in the Site Session screen / list card).
- Want a clean slate → sign up with new emails; each team is isolated.

## Talking points

- Offline-first: SQLite-free on the phone — the checklist is a Yjs CRDT document persisted locally and synced through Hocuspocus; no lost writes, no manual merge screens.
- Safety rules live on the server (`shared/src/editlog/rules.ts`): fail-beats-pass, numeric tolerance bands, photos always kept.
- Photos are content-addressed and verified byte-for-byte on upload (tus resumable uploads survive dropped connections).
- Every route is JWT-authenticated and team-scoped; the WebSocket refuses non-members.
