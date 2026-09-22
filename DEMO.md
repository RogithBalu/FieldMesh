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
7. **Offline mesh — two phones, no internet at all (90 s)** — put BOTH phones in airplane mode, then switch Bluetooth and Wi-Fi back on (airplane mode keeps mobile data off). On each phone open the inspection and tap "Start mesh" in the blue banner (or the "On site" badge → Site Session → Start offline mesh). Grant the Nearby/Bluetooth permission. Within ~10 s the checklist badge reads "Mesh · 2 nearby" and the Site Session screen lists the other phone with its medium (Bluetooth, then Wi-Fi Direct / hotspot once Nearby upgrades the link). Change a value on one phone; it appears on the other with no server involved. Now re-enable mobile data on ONE phone only: its Site Session row shows "Internet", the other phone's row gains "RELAYS TO CLOUD", and both phones' edits reach the server through that single phone — the audit trail on the laptop shows edits from both devices.
8. **Hotspot relay with QR — no Bluetooth needed (90 s)** — on the host phone open the inspection → "On site" badge → Site Session → **Host a hotspot session**. Allow the nearby-devices/location permission. The card shows the hotspot SSID and passphrase, the hub address, the session key, and a QR. On each other phone: Site Session → **Scan a session QR to join** → point the camera at the host's QR (or paste the copied session code). Android asks once to connect to the host's Wi-Fi; tap connect. The joiner shows "Joined", the host shows "Hosting · N joined", and the members list shows each phone with medium "Wi-Fi hotspot". Edits sync through the host; if the host has mobile data, it relays everything to the cloud. Tap "Show plain Wi-Fi QR" for a code the phone's own camera app can join from.
9. **Offline launch (30 s, optional)** — force-close the app on airplane mode and reopen: session, inspection list and checklist all load from the phone; the badge says "Saved on phone", and everything syncs when signal returns.

## If something goes wrong on stage

- Health pill on the login screen red → laptop hotspot + local server: run `pnpm dev:server` in `Backend`, then in the app tap the pill → "Join another session" → enter the laptop's IP → Test → Use this server.
- Only one phone available → run the teammate simulator from the laptop to create the conflicting edits:
  `cd Backend/server && BASE=http://98.80.162.7:3000 WS=ws://98.80.162.7:1234 EMAIL=priya@test.dev INSPECTION=<id> FIELD=insulation_condition VALUE=fail pnpm test:teammate` (the inspection id is in the Site Session screen / list card).
- Want a clean slate → sign up with new emails; each team is isolated.
- Mesh does not find the other phone → both phones must have Bluetooth AND Wi-Fi on, location services on (Android ≤ 12), Google Play services present, and the same inspection open with "Start mesh" tapped on both. Keep them within a few metres. The mesh is per inspection: starting it on another inspection replaces the session.
- Expo Go cannot run the mesh or the hotspot (they need the native modules in `modules/`): use the installed APK for the offline part of the demo. The QR scanner does work in Expo Go.
- Hotspot join fails → the joiner can connect to the host's SSID manually from Wi-Fi settings (use the passphrase on the host's screen), then tap "Retry connecting to the hub".
- Hotspot start fails with "incompatible mode" → the host phone already has tethering/hotspot on; switch it off first. Local-only hotspots get a random SSID/passphrase from Android — that is expected.

## Talking points

- Offline-first: SQLite-free on the phone — the checklist is a Yjs CRDT document persisted locally and synced through Hocuspocus; no lost writes, no manual merge screens.
- Offline mesh: Google Nearby Connections (Bluetooth discovery, automatic Wi-Fi Direct / hotspot upgrade) with one Yjs sync per link on the same document, so a phone with internet relays for every phone linked to it — the "chain relay". Each member's medium is shown on the Site Session screen.
- Safety rules live on the server (`shared/src/editlog/rules.ts`): fail-beats-pass, numeric tolerance bands, photos always kept.
- Photos are content-addressed and verified byte-for-byte on upload (tus resumable uploads survive dropped connections).
- Every route is JWT-authenticated and team-scoped; the WebSocket refuses non-members.
