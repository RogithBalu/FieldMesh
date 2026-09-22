import Fastify from "fastify";
import cors from "@fastify/cors";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { db } from "../db/index.js";
import { registerAuth } from "../auth/jwt.js";
import { inspectionRoutes } from "../inspections/routes.js";
import { createHocuspocus } from "../sync/hocuspocus.js";
import { tick, encodeHlc, type EditEntry } from "@fieldmesh/shared";

async function run() {
  console.log("Starting Task 1 Acceptance Test...");

  const userId = "test-user-supervisor-1";
  const teamId = "test-team-1";
  const liveInspId = "insp-live-test";
  const coldInspId = "insp-cold-test";

  // Setup seed database records
  db.prepare(
    "INSERT OR REPLACE INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, "Test Supervisor", "sup@fieldmesh.dev", "hash", "supervisor");
  db.prepare("INSERT OR REPLACE INTO teams (id, name) VALUES (?, ?)").run(
    teamId,
    "Test Engineering Team"
  );
  db.prepare(
    "INSERT OR REPLACE INTO team_members (team_id, user_id) VALUES (?, ?)"
  ).run(teamId, userId);
  db.prepare(
    "INSERT OR REPLACE INTO inspections (id, team_id, title, site, created_by, created_at, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(liveInspId, teamId, "Live Test Inspection", "Site A", userId, Date.now(), 1);
  db.prepare(
    "INSERT OR REPLACE INTO inspections (id, team_id, title, site, created_by, created_at, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(coldInspId, teamId, "Cold Test Inspection", "Site B", userId, Date.now(), 1);

  // Clean tables for these inspection IDs
  db.prepare("DELETE FROM edits WHERE inspection_id IN (?, ?)").run(
    liveInspId,
    coldInspId
  );
  db.prepare("DELETE FROM yjs_documents WHERE doc_name IN (?, ?)").run(
    `inspection:${liveInspId}`,
    `inspection:${coldInspId}`
  );
  db.prepare("DELETE FROM yjs_updates WHERE doc_name IN (?, ?)").run(
    `inspection:${liveInspId}`,
    `inspection:${coldInspId}`
  );

  const HOCUSPOCUS_TEST_PORT = 12348;
  process.env.HOCUSPOCUS_PORT = String(HOCUSPOCUS_TEST_PORT);

  const app = Fastify();
  await app.register(cors);
  await registerAuth(app);

  const hocuspocus = createHocuspocus(app);
  app.decorate("hocuspocus", hocuspocus);
  await app.register(inspectionRoutes);

  await hocuspocus.listen();
  console.log(`Hocuspocus server listening on port ${HOCUSPOCUS_TEST_PORT}`);

  const token = app.jwt.sign({ sub: userId, role: "supervisor" });

  // -------------------------------------------------------------
  // PART 1: Live Connected Client
  // -------------------------------------------------------------
  console.log("\n=== PART 1: Live Connected Client ===");
  const clientDoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${HOCUSPOCUS_TEST_PORT}`,
    name: `inspection:${liveInspId}`,
    token,
    document: clientDoc,
    WebSocketPolyfill: WebSocket,
  } as any);

  await new Promise<void>((resolve) => {
    if (provider.isSynced) return resolve();
    provider.on("synced", () => resolve());
  });
  console.log("[Client] Connected and synced with Hocuspocus.");

  // Create genuine dispute: two concurrent edits for field "roof_condition"
  const baseHlc = { wall: Date.now(), counter: 0, node: "clientA" };
  const edit1: EditEntry = {
    id: "edit-roof-branch-1",
    fieldId: "roof_condition",
    value: "Needs urgent tile replacement",
    author: userId,
    device: "field-tablet-1",
    hlc: encodeHlc(baseHlc),
    parents: [],
    schemaVersion: 1,
  };
  const edit2: EditEntry = {
    id: "edit-roof-branch-2",
    fieldId: "roof_condition",
    value: "Passes inspection with minor wear",
    author: userId,
    device: "field-tablet-2",
    hlc: encodeHlc(tick(baseHlc, "clientB")),
    parents: [], // concurrent, no parent relationship
    schemaVersion: 1,
  };

  clientDoc.transact(() => {
    const editsMap = clientDoc.getMap("edits");
    editsMap.set(edit1.id, edit1);
    editsMap.set(edit2.id, edit2);
  });

  // Wait for server to process onChange and update SQLite edits table
  let disputes: any[] = [];
  for (let i = 0; i < 30; i++) {
    const res = await app.inject({
      method: "GET",
      url: `/inspections/${liveInspId}/disputes`,
      headers: { authorization: `Bearer ${token}` },
    });
    disputes = res.json();
    if (disputes.length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`Disputes found on server: ${disputes.length}`);
  if (disputes.length !== 2) {
    throw new Error(`Expected 2 disputes on server, found ${disputes.length}`);
  }
  for (const d of disputes) {
    console.log(`  - disputed edit: ${d.edit_id}, value: "${d.value}", disputed=${d.disputed}`);
  }

  // Setup client observer to track live incoming resolution over WebSocket
  let receivedResolutionEdit: any = null;
  const editsMap = clientDoc.getMap("edits");
  const updatePromise = new Promise<any>((resolve) => {
    editsMap.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add" || change.action === "update") {
          const val = editsMap.get(key) as any;
          if (
            val &&
            val.fieldId === "roof_condition" &&
            val.id !== edit1.id &&
            val.id !== edit2.id
          ) {
            receivedResolutionEdit = val;
            resolve(val);
          }
        }
      });
    });
  });

  console.log("Calling POST /inspections/:id/resolve...");
  const resolveRes = await app.inject({
    method: "POST",
    url: `/inspections/${liveInspId}/resolve`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fieldId: "roof_condition",
      value: "Replaced damaged tiles; certified waterproof by supervisor",
      device: "supervisor-station",
    },
  });

  console.log("Resolve response status:", resolveRes.statusCode);
  const resolveBody = resolveRes.json();
  console.log("Resolve response body:", resolveBody);
  const { editId: resolvedEditId } = resolveBody;

  // Wait for live client to receive update
  const received = await Promise.race([
    updatePromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for live update on client")), 5000)
    ),
  ]);

  console.log("\n>>> LIVE UPDATE RECEIVED BY CONNECTED CLIENT <<<");
  console.log("Client observed resolution EditEntry:", JSON.stringify(received, null, 2));

  if (received.id !== resolvedEditId) {
    throw new Error(`Received id ${received.id} !== expected ${resolvedEditId}`);
  }
  if (received.value !== "Replaced damaged tiles; certified waterproof by supervisor") {
    throw new Error(`Received value does not match expected`);
  }
  if (received.parents.length !== 2) {
    throw new Error(`Expected resolution edit to have 2 parents, got: ${received.parents.length}`);
  }

  // Check /disputes endpoint
  const disputesAfter = await app.inject({
    method: "GET",
    url: `/inspections/${liveInspId}/disputes`,
    headers: { authorization: `Bearer ${token}` },
  });
  console.log("Server disputes after resolution:", disputesAfter.json());
  if (disputesAfter.json().length !== 0) {
    throw new Error("Expected 0 disputes after resolution");
  }

  // Also verify resolution edit in SQLite edits table has disputed = 0
  const sqliteResolutionRow = db
    .prepare("SELECT * FROM edits WHERE edit_id = ?")
    .get(resolvedEditId) as any;
  console.log("SQLite row for resolution edit:", {
    edit_id: sqliteResolutionRow.edit_id,
    disputed: sqliteResolutionRow.disputed,
    parents: sqliteResolutionRow.parents,
    author: sqliteResolutionRow.author,
  });
  if (sqliteResolutionRow.disputed !== 0) {
    throw new Error("Resolution edit row in SQLite has disputed !== 0");
  }

  provider.destroy();
  console.log("PART 1: PASSED!\n");

  // -------------------------------------------------------------
  // PART 2: Cold Document (No Client Connected)
  // -------------------------------------------------------------
  console.log("=== PART 2: Cold Document (No Client Connected) ===");
  // Seed dispute in cold document's snapshot + edits table
  const coldBaseHlc = { wall: Date.now(), counter: 0, node: "techA" };
  const coldEdit1: EditEntry = {
    id: "cold-edit-branch-1",
    fieldId: "foundation_status",
    value: "Minor hairline cracks observed at south corner",
    author: userId,
    device: "mobile-field-1",
    hlc: encodeHlc(coldBaseHlc),
    parents: [],
    schemaVersion: 1,
  };
  const coldEdit2: EditEntry = {
    id: "cold-edit-branch-2",
    fieldId: "foundation_status",
    value: "Structural settlement requires immediate underpinning",
    author: userId,
    device: "mobile-field-2",
    hlc: encodeHlc(tick(coldBaseHlc, "techB")),
    parents: [],
    schemaVersion: 1,
  };

  db.prepare(`
    INSERT INTO edits (edit_id, inspection_id, field_id, value, author, device, hlc, parents, schema_version, disputed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    coldEdit1.id,
    coldInspId,
    coldEdit1.fieldId,
    coldEdit1.value,
    coldEdit1.author,
    coldEdit1.device,
    coldEdit1.hlc,
    JSON.stringify(coldEdit1.parents),
    1
  );

  db.prepare(`
    INSERT INTO edits (edit_id, inspection_id, field_id, value, author, device, hlc, parents, schema_version, disputed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    coldEdit2.id,
    coldInspId,
    coldEdit2.fieldId,
    coldEdit2.value,
    coldEdit2.author,
    coldEdit2.device,
    coldEdit2.hlc,
    JSON.stringify(coldEdit2.parents),
    1
  );

  // Store snapshot in yjs_documents as if written previously
  const initialColdDoc = new Y.Doc();
  const initialColdMap = initialColdDoc.getMap("edits");
  initialColdMap.set(coldEdit1.id, coldEdit1);
  initialColdMap.set(coldEdit2.id, coldEdit2);
  const snapshotBlob = Buffer.from(Y.encodeStateAsUpdate(initialColdDoc));
  db.prepare(`
    INSERT INTO yjs_documents (doc_name, state, updated_at)
    VALUES (?, ?, ?)
  `).run(`inspection:${coldInspId}`, snapshotBlob, Date.now());

  // Confirm document is not currently connected in Hocuspocus
  const docName = `inspection:${coldInspId}`;
  console.log(`Calling POST /inspections/:id/resolve on cold doc "${docName}" (0 connected clients)...`);

  const coldResolveRes = await app.inject({
    method: "POST",
    url: `/inspections/${coldInspId}/resolve`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fieldId: "foundation_status",
      value: "Underpinning completed; settlement stabilized; signed by PE",
      device: "lead-engineer-laptop",
    },
  });

  console.log("Cold resolve response status:", coldResolveRes.statusCode);
  const coldResolveBody = coldResolveRes.json();
  console.log("Cold resolve body:", coldResolveBody);
  const { editId: coldResolvedId } = coldResolveBody;

  // Confirm resolution was written to SQLite edits table by onChange
  const coldDbRow = db
    .prepare("SELECT * FROM edits WHERE edit_id = ?")
    .get(coldResolvedId) as any;
  console.log("SQLite row for cold resolution edit:", {
    edit_id: coldDbRow.edit_id,
    disputed: coldDbRow.disputed,
    parents: coldDbRow.parents,
    value: coldDbRow.value,
  });
  if (!coldDbRow) throw new Error("Cold resolution edit not found in SQLite!");
  if (coldDbRow.disputed !== 0) throw new Error("Cold resolution edit disputed !== 0");

  // Confirm /disputes returns 0 disputes
  const coldDisputes = await app.inject({
    method: "GET",
    url: `/inspections/${coldInspId}/disputes`,
    headers: { authorization: `Bearer ${token}` },
  });
  console.log("Cold disputes after resolve:", coldDisputes.json());
  if (coldDisputes.json().length !== 0) {
    throw new Error("Expected 0 disputes after cold resolve");
  }

  // Connect a new client AFTER the resolution was applied to cold doc
  console.log("\nConnecting a client AFTER the resolution to verify full state sync...");
  const lateClientDoc = new Y.Doc();
  const lateProvider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${HOCUSPOCUS_TEST_PORT}`,
    name: `inspection:${coldInspId}`,
    token,
    document: lateClientDoc,
    WebSocketPolyfill: WebSocket,
  } as any);

  await new Promise<void>((resolve) => {
    if (lateProvider.isSynced) return resolve();
    lateProvider.on("synced", () => resolve());
  });

  const lateEditsMap = lateClientDoc.getMap("edits");
  const lateResolved = lateEditsMap.get(coldResolvedId) as any;
  console.log("Late client received resolved edit from sync:", JSON.stringify(lateResolved, null, 2));

  if (!lateResolved) {
    throw new Error(`Late client did not find resolution edit ${coldResolvedId}`);
  }
  if (
    lateResolved.value !==
    "Underpinning completed; settlement stabilized; signed by PE"
  ) {
    throw new Error("Late client received incorrect value");
  }

  lateProvider.destroy();
  console.log("PART 2: PASSED!\n");

  await app.close();
  await hocuspocus.destroy();
  console.log("ALL ACCEPTANCE TESTS FOR TASK 1 PASSED SUCCESSFULLY!");
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
