import * as Y from "yjs";
import { db } from "../db/index.js";
import { onLoadDocument, onChange, onStoreDocument } from "../sync/persist.js";
import {
  mergeConcurrent,
  type EditEntry,
  type FieldType,
} from "@fieldmesh/shared";

// PRNG (Mulberry32) for reproducible chaotic schedules
function createRng(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ClientAction {
  clientIndex: number;
  edit: EditEntry;
}

function buildScenario(): ClientAction[] {
  return [
    // Client 0 edits
    {
      clientIndex: 0,
      edit: {
        id: "edit-temp-1",
        fieldId: "field_temp",
        value: 20.0,
        author: "tech-0",
        device: "dev-0",
        hlc: "1000:0:client-0",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 0,
      edit: {
        id: "edit-volt-1",
        fieldId: "field_voltage",
        value: 120.0,
        author: "tech-0",
        device: "dev-0",
        hlc: "1000:0:client-0",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 0,
      edit: {
        id: "edit-safe-1",
        fieldId: "field_safety",
        value: "pass",
        author: "tech-0",
        device: "dev-0",
        hlc: "1000:0:client-0",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 0,
      edit: {
        id: "edit-struct-1",
        fieldId: "field_structural",
        value: "Foundation footing poured",
        author: "tech-0",
        device: "dev-0",
        hlc: "1000:0:client-0",
        parents: [],
        schemaVersion: 1,
      },
    },

    // Client 1 edits
    {
      clientIndex: 1,
      edit: {
        id: "edit-temp-2",
        fieldId: "field_temp",
        value: 21.0,
        author: "tech-1",
        device: "dev-1",
        hlc: "1001:0:client-1",
        parents: ["edit-temp-1"],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 1,
      edit: {
        id: "edit-notes-1",
        fieldId: "field_notes",
        value: "Site inspection begun",
        author: "tech-1",
        device: "dev-1",
        hlc: "1000:0:client-1",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 1,
      edit: {
        id: "edit-volt-2",
        fieldId: "field_voltage",
        value: 115.0,
        author: "tech-1",
        device: "dev-1",
        hlc: "1001:0:client-1",
        parents: ["edit-volt-1"], // branch A
        schemaVersion: 1,
      },
    },

    // Client 2 edits (starts disconnected)
    {
      clientIndex: 2,
      edit: {
        id: "edit-temp-3",
        fieldId: "field_temp",
        value: 21.5,
        author: "tech-2",
        device: "dev-2",
        hlc: "1002:0:client-2",
        parents: ["edit-temp-2"], // branch A
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 2,
      edit: {
        id: "edit-safe-2",
        fieldId: "field_safety",
        value: "pass",
        author: "tech-2",
        device: "dev-2",
        hlc: "1001:0:client-2",
        parents: ["edit-safe-1"], // branch A
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 2,
      edit: {
        id: "edit-struct-2",
        fieldId: "field_structural",
        value: "Beam intact and true",
        author: "tech-2",
        device: "dev-2",
        hlc: "1001:0:client-2",
        parents: ["edit-struct-1"], // branch A
        schemaVersion: 1,
      },
    },

    // Client 3 edits
    {
      clientIndex: 3,
      edit: {
        id: "edit-temp-4",
        fieldId: "field_temp",
        value: 22.0,
        author: "tech-3",
        device: "dev-3",
        hlc: "1002:0:client-3",
        parents: ["edit-temp-2"], // branch B (concurrent with edit-temp-3)
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 3,
      edit: {
        id: "edit-safe-3",
        fieldId: "field_safety",
        value: "fail",
        author: "tech-3",
        device: "dev-3",
        hlc: "1001:0:client-3",
        parents: ["edit-safe-1"], // branch B (concurrent with edit-safe-2 -> disputed)
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 3,
      edit: {
        id: "edit-struct-3",
        fieldId: "field_structural",
        value: "Beam deflected 5mm under load",
        author: "tech-3",
        device: "dev-3",
        hlc: "1001:0:client-3",
        parents: ["edit-struct-1"], // branch B (concurrent with edit-struct-2 -> disputed)
        schemaVersion: 1,
      },
    },

    // Client 4 edits (starts disconnected)
    {
      clientIndex: 4,
      edit: {
        id: "edit-volt-3",
        fieldId: "field_voltage",
        value: 135.0,
        author: "tech-4",
        device: "dev-4",
        hlc: "1001:0:client-4",
        parents: ["edit-volt-1"], // branch B (concurrent with edit-volt-2 -> diff=20 > tol 1.0 -> disputed)
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 4,
      edit: {
        id: "edit-notes-2",
        fieldId: "field_notes",
        value: "Weather condition: heavy rain",
        author: "tech-4",
        device: "dev-4",
        hlc: "1001:0:client-4",
        parents: ["edit-notes-1"],
        schemaVersion: 1,
      },
    },

    // Client 5 edits
    {
      clientIndex: 5,
      edit: {
        id: "edit-notes-3",
        fieldId: "field_notes",
        value: "Excavation delayed due to rain",
        author: "tech-5",
        device: "dev-5",
        hlc: "1002:0:client-5",
        parents: ["edit-notes-2"],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 5,
      edit: {
        id: "edit-notes-4",
        fieldId: "field_notes",
        value: "Pumps installed, work resumed",
        author: "tech-5",
        device: "dev-5",
        hlc: "1003:0:client-5",
        parents: ["edit-notes-3"], // single head for notes -> undisputed
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 5,
      edit: {
        id: "edit-temp-5",
        fieldId: "field_temp",
        value: 21.8,
        author: "tech-5",
        device: "dev-5",
        hlc: "1003:0:client-5",
        parents: ["edit-temp-4"], // supersedes branch B (edit-temp-4 is now parent!)
        // Heads are now edit-temp-3 (21.5) and edit-temp-5 (21.8). Diff = 0.3 <= tol 2.0 -> undisputed!
        schemaVersion: 1,
      },
    },

    // Additional edits across clients for extra load & coverage
    {
      clientIndex: 0,
      edit: {
        id: "edit-plumb-1",
        fieldId: "field_plumbing",
        value: "Rough-in complete",
        author: "tech-0",
        device: "dev-0",
        hlc: "1000:0:client-0",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 1,
      edit: {
        id: "edit-plumb-2",
        fieldId: "field_plumbing",
        value: "Pressure test 60 psi",
        author: "tech-1",
        device: "dev-1",
        hlc: "1001:0:client-1",
        parents: ["edit-plumb-1"],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 2,
      edit: {
        id: "edit-plumb-3",
        fieldId: "field_plumbing",
        value: "Pressure test held for 2 hours",
        author: "tech-2",
        device: "dev-2",
        hlc: "1002:0:client-2",
        parents: ["edit-plumb-2"],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 3,
      edit: {
        id: "edit-access-1",
        fieldId: "field_access",
        value: "North gate unlocked",
        author: "tech-3",
        device: "dev-3",
        hlc: "1000:0:client-3",
        parents: [], // concurrent root 1
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 4,
      edit: {
        id: "edit-access-2",
        fieldId: "field_access",
        value: "North gate locked with MasterKey #4",
        author: "tech-4",
        device: "dev-4",
        hlc: "1000:0:client-4",
        parents: [], // concurrent root 2 -> disputed!
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 5,
      edit: {
        id: "edit-insul-1",
        fieldId: "field_insulation",
        value: "R-13 batts installed",
        author: "tech-5",
        device: "dev-5",
        hlc: "1000:0:client-5",
        parents: [],
        schemaVersion: 1,
      },
    },
    {
      clientIndex: 0,
      edit: {
        id: "edit-insul-2",
        fieldId: "field_insulation",
        value: "Vapor barrier taped and sealed",
        author: "tech-0",
        device: "dev-0",
        hlc: "1001:0:client-0",
        parents: ["edit-insul-1"],
        schemaVersion: 1,
      },
    },
  ];
}

interface RunResult {
  seed: number;
  clientDocUpdates: Buffer[];
  serverDocUpdate: Buffer;
  reloadedServerUpdate: Buffer;
  serverDocJson: { edits: any; fields: any };
  dbEdits: Array<{
    edit_id: string;
    field_id: string;
    disputed: number;
    parents: string;
  }>;
  totalPacketsExchanged: number;
  totalEditsCreated: number;
}

async function runChaosSimulation(seed: number): Promise<RunResult> {
  const rng = createRng(seed);
  const CLIENT_COUNT = 6;
  const DISCONNECTED_CLIENTS = new Set<number>([2, 4]); // Clients 2 & 4 start offline

  const inspectionId = "chaos-inspection";
  const docName = `inspection:${inspectionId}`;

  // Clean SQLite tables for this inspection before this run
  db.prepare("DELETE FROM edits WHERE inspection_id = ?").run(inspectionId);
  db.prepare("DELETE FROM yjs_documents WHERE doc_name = ?").run(docName);
  db.prepare("DELETE FROM yjs_updates WHERE doc_name = ?").run(docName);
  db.prepare("DELETE FROM field_defs WHERE inspection_id = ?").run(inspectionId);

  // Setup field_defs in SQLite
  const insertFieldDef = db.prepare(
    "INSERT INTO field_defs (inspection_id, field_id, type, tolerance) VALUES (?, ?, ?, ?)"
  );
  insertFieldDef.run(inspectionId, "field_temp", "numeric", 2.0);
  insertFieldDef.run(inspectionId, "field_voltage", "numeric", 1.0);
  insertFieldDef.run(inspectionId, "field_safety", "pass_fail", null);
  insertFieldDef.run(inspectionId, "field_notes", "notes", null);
  insertFieldDef.run(inspectionId, "field_structural", "short_text", null);
  insertFieldDef.run(inspectionId, "field_plumbing", "short_text", null);
  insertFieldDef.run(inspectionId, "field_access", "short_text", null);
  insertFieldDef.run(inspectionId, "field_insulation", "short_text", null);

  // Initialize N clients with stable clientIDs for reproducible CRDT structs
  const clientDocs: Y.Doc[] = [];
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const doc = new Y.Doc();
    doc.clientID = 1000 + i;
    clientDocs.push(doc);
  }

  // Initialize Server Doc
  const serverDoc = new Y.Doc();
  serverDoc.clientID = 9999;

  // Packet tracking
  interface Packet {
    id: number;
    fromClient: number;
    update: Uint8Array;
    deliveredToClients: Set<number>;
    deliveredToServer: boolean;
  }

  let nextPacketId = 1;
  const activePacketPool: Packet[] = [];
  const withheldPacketsByClient = new Map<number, Packet[]>();
  for (const c of DISCONNECTED_CLIENTS) {
    withheldPacketsByClient.set(c, []);
  }

  // Attach update listeners to clients
  clientDocs.forEach((doc, clientIdx) => {
    doc.on("update", (update, origin) => {
      if (origin === "local") {
        const packet: Packet = {
          id: nextPacketId++,
          fromClient: clientIdx,
          update,
          deliveredToClients: new Set([clientIdx]),
          deliveredToServer: false,
        };

        if (DISCONNECTED_CLIENTS.has(clientIdx)) {
          withheldPacketsByClient.get(clientIdx)!.push(packet);
        } else {
          activePacketPool.push(packet);
        }
      }
    });
  });

  // Generate scenario edits
  const scenario = buildScenario();
  for (const action of scenario) {
    const doc = clientDocs[action.clientIndex];
    doc.transact(() => {
      doc.getMap("edits").set(action.edit.id, action.edit);
      doc.getMap("fields").set(action.edit.fieldId, action.edit.value);
    }, "local");
  }

  const totalEditsCreated = scenario.length;

  // Chaotic network scheduler
  let totalPacketsExchanged = 0;
  let reconnected = false;

  // Fisher-Yates shuffle array helper with our PRNG
  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Shuffle initial pool
  shuffle(activePacketPool);

  let steps = 0;
  while (true) {
    // Check if we should reconnect offline clients (reconnect when 40% of initial active pool is delivered to server)
    if (!reconnected && steps > 10) {
      reconnected = true;
      for (const [c, packets] of withheldPacketsByClient) {
        shuffle(packets);
        for (const p of packets) {
          activePacketPool.push(p);
        }
        withheldPacketsByClient.set(c, []);
      }
      shuffle(activePacketPool);
    }

    // Find packets that still have pending deliveries
    const pendingPackets = activePacketPool.filter((p) => {
      if (!p.deliveredToServer) return true;
      for (let i = 0; i < CLIENT_COUNT; i++) {
        // If client is still offline, skip checking it
        if (!reconnected && DISCONNECTED_CLIENTS.has(i)) continue;
        if (!p.deliveredToClients.has(i)) return true;
      }
      return false;
    });

    if (pendingPackets.length === 0) {
      if (!reconnected) {
        // Force reconnect if not done yet
        steps = 999;
        continue;
      }
      break;
    }

    steps++;
    // Pick a random pending packet
    const pIdx = Math.floor(rng() * pendingPackets.length);
    const packet = pendingPackets[pIdx];

    // Maybe deliver to server
    if (!packet.deliveredToServer && rng() > 0.3) {
      Y.applyUpdate(serverDoc, packet.update, "network");
      await onChange({
        documentName: docName,
        update: packet.update,
        document: serverDoc as any,
        context: {},
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        instance: null as any,
        clientsCount: 1,
      } as any);
      packet.deliveredToServer = true;
      totalPacketsExchanged++;

      // Periodic intermediate store snapshot to test persistence compaction mid-chaos
      if (steps % 7 === 0) {
        await onStoreDocument({
          documentName: docName,
          document: serverDoc as any,
          context: {},
          requestHeaders: {},
          requestParameters: new URLSearchParams(),
          instance: null as any,
          clientsCount: 1,
        } as any);
      }
    }

    // Pick random target clients that don't have it yet
    const candidateClients: number[] = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
      if (!reconnected && DISCONNECTED_CLIENTS.has(i)) continue;
      if (!packet.deliveredToClients.has(i)) candidateClients.push(i);
    }

    if (candidateClients.length > 0) {
      // Pick 1 to candidateClients.length clients to deliver to
      const targetClient =
        candidateClients[Math.floor(rng() * candidateClients.length)];
      Y.applyUpdate(clientDocs[targetClient], packet.update, "network");
      packet.deliveredToClients.add(targetClient);
      totalPacketsExchanged++;
    }
  }

  // Ensure all packets delivered to server
  for (const packet of activePacketPool) {
    if (!packet.deliveredToServer) {
      Y.applyUpdate(serverDoc, packet.update, "network");
      await onChange({
        documentName: docName,
        update: packet.update,
        document: serverDoc as any,
        context: {},
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        instance: null as any,
        clientsCount: 1,
      } as any);
      packet.deliveredToServer = true;
    }
    for (let i = 0; i < CLIENT_COUNT; i++) {
      if (!packet.deliveredToClients.has(i)) {
        Y.applyUpdate(clientDocs[i], packet.update, "network");
        packet.deliveredToClients.add(i);
      }
    }
  }

  // Final store snapshot
  await onStoreDocument({
    documentName: docName,
    document: serverDoc as any,
    context: {},
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    instance: null as any,
    clientsCount: 1,
  } as any);

  // Reload document from SQLite via onLoadDocument
  const reloadedServerDoc = new Y.Doc();
  await onLoadDocument({
    documentName: docName,
    document: reloadedServerDoc as any,
    context: {},
    requestHeaders: {},
    requestParameters: new URLSearchParams(),
    instance: null as any,
  } as any);

  // Query SQLite edits
  const dbEdits = db
    .prepare(
      "SELECT edit_id, field_id, disputed, parents FROM edits WHERE inspection_id = ? ORDER BY edit_id ASC"
    )
    .all(inspectionId) as Array<{
    edit_id: string;
    field_id: string;
    disputed: number;
    parents: string;
  }>;

  return {
    seed,
    clientDocUpdates: clientDocs.map((d) =>
      Buffer.from(Y.encodeStateAsUpdate(d))
    ),
    serverDocUpdate: Buffer.from(Y.encodeStateAsUpdate(serverDoc)),
    reloadedServerUpdate: Buffer.from(Y.encodeStateAsUpdate(reloadedServerDoc)),
    serverDocJson: {
      edits: serverDoc.getMap("edits").toJSON(),
      fields: serverDoc.getMap("fields").toJSON(),
    },
    dbEdits,
    totalPacketsExchanged,
    totalEditsCreated,
  };
}

async function main() {
  console.log("========================================================================");
  console.log("  FieldMesh Merge Correctness & Chaos Convergence Test");
  console.log("========================================================================");
  console.log("Simulating 6 concurrent Yjs clients, offline withholding, out-of-order");
  console.log("network delivery, and full SQLite persist.ts round-trip.\n");

  const SEED_1 = 1337;
  const SEED_2 = 80085;

  console.log(`[Run 1] Executing chaos simulation with Seed = ${SEED_1}...`);
  const run1 = await runChaosSimulation(SEED_1);
  console.log(`  - Packets exchanged across clients/server: ${run1.totalPacketsExchanged}`);
  console.log(`  - Edits created: ${run1.totalEditsCreated}`);
  console.log(`  - Edits in SQLite: ${run1.dbEdits.length}`);

  console.log(`\n[Run 2] Executing chaos simulation with Seed = ${SEED_2}...`);
  const run2 = await runChaosSimulation(SEED_2);
  console.log(`  - Packets exchanged across clients/server: ${run2.totalPacketsExchanged}`);
  console.log(`  - Edits created: ${run2.totalEditsCreated}`);
  console.log(`  - Edits in SQLite: ${run2.dbEdits.length}`);

  console.log("\n------------------------------------------------------------------------");
  console.log("VERIFICATION LAYER A: Raw Convergence Sanity Check");
  console.log("------------------------------------------------------------------------");

  // Check Run 1 convergence
  console.log(`Asserting Run 1 (${SEED_1}) convergence:`);
  for (let i = 0; i < run1.clientDocUpdates.length; i++) {
    const cmpServer = Buffer.compare(
      run1.clientDocUpdates[i],
      run1.serverDocUpdate
    );
    if (cmpServer !== 0) {
      throw new Error(`Run 1: Client ${i} doc state != Server doc state`);
    }
  }
  const cmpRun1Reload = Buffer.compare(
    run1.serverDocUpdate,
    run1.reloadedServerUpdate
  );
  if (cmpRun1Reload !== 0) {
    throw new Error("Run 1: Reloaded Server Doc (from SQLite snapshot+updates) != Live Server Doc!");
  }
  console.log("  [PASS] All 6 client docs, live server doc, and SQLite-reloaded doc are BIT-IDENTICAL.");

  // Check Run 2 convergence
  console.log(`Asserting Run 2 (${SEED_2}) convergence:`);
  for (let i = 0; i < run2.clientDocUpdates.length; i++) {
    const cmpServer = Buffer.compare(
      run2.clientDocUpdates[i],
      run2.serverDocUpdate
    );
    if (cmpServer !== 0) {
      throw new Error(`Run 2: Client ${i} doc state != Server doc state`);
    }
  }
  const cmpRun2Reload = Buffer.compare(
    run2.serverDocUpdate,
    run2.reloadedServerUpdate
  );
  if (cmpRun2Reload !== 0) {
    throw new Error("Run 2: Reloaded Server Doc (from SQLite snapshot+updates) != Live Server Doc!");
  }
  console.log("  [PASS] All 6 client docs, live server doc, and SQLite-reloaded doc are BIT-IDENTICAL.");

  // Compare Run 1 vs Run 2 edits map content (sorted keys)
  const keys1 = Object.keys(run1.serverDocJson.edits).sort();
  const keys2 = Object.keys(run2.serverDocJson.edits).sort();
  if (JSON.stringify(keys1) !== JSON.stringify(keys2)) {
    throw new Error("Cross-seed edits keys mismatch!");
  }
  for (const k of keys1) {
    if (
      JSON.stringify(run1.serverDocJson.edits[k]) !==
      JSON.stringify(run2.serverDocJson.edits[k])
    ) {
      throw new Error(`Cross-seed edit content mismatch for ${k}`);
    }
  }
  console.log("  [PASS] Top-level 'edits' map entries are 100% IDENTICAL across different random orderings/seeds!");

  console.log("\n------------------------------------------------------------------------");
  console.log("VERIFICATION LAYER B: Edit-Log & Dispute Correctness Under Chaos");
  console.log("------------------------------------------------------------------------");

  // 1. Check exact edit counts
  console.log(`Total generated edits: ${run1.totalEditsCreated}`);
  console.log(`Run 1 SQLite edits landed: ${run1.dbEdits.length}`);
  console.log(`Run 2 SQLite edits landed: ${run2.dbEdits.length}`);

  if (run1.dbEdits.length !== run1.totalEditsCreated) {
    throw new Error(`Run 1 edits count mismatch! Expected ${run1.totalEditsCreated}, got ${run1.dbEdits.length}`);
  }
  if (run2.dbEdits.length !== run2.totalEditsCreated) {
    throw new Error(`Run 2 edits count mismatch! Expected ${run2.totalEditsCreated}, got ${run2.dbEdits.length}`);
  }
  console.log("  [PASS] Every edit landed in SQLite exactly once (no duplicates, no loss).");

  // 2. Compare disputes against mergeConcurrent ground truth
  const fieldTypes: Record<string, { type: FieldType; tolerance?: number }> = {
    field_temp: { type: "numeric", tolerance: 2.0 },
    field_voltage: { type: "numeric", tolerance: 1.0 },
    field_safety: { type: "pass_fail" },
    field_notes: { type: "notes" },
    field_structural: { type: "short_text" },
    field_plumbing: { type: "short_text" },
    field_access: { type: "short_text" },
    field_insulation: { type: "short_text" },
  };

  function evaluateExpectedFieldDisputes(
    fieldId: string,
    edits: typeof run1.dbEdits
  ) {
    const fieldEdits = edits.filter((e) => e.field_id === fieldId);
    const parentIds = new Set<string>();
    for (const e of fieldEdits) {
      const pList: string[] = JSON.parse(e.parents || "[]");
      for (const p of pList) parentIds.add(p);
    }
    const heads = fieldEdits.filter((e) => !parentIds.has(e.edit_id));
    const nonHeads = fieldEdits.filter((e) => parentIds.has(e.edit_id));

    const def = fieldTypes[fieldId];
    let expectedDisputed = 0;
    if (heads.length > 1) {
      const entries: EditEntry[] = heads.map((h) => ({
        id: h.edit_id,
        fieldId,
        value: null,
        author: "",
        device: "",
        hlc: "",
        parents: [],
        schemaVersion: 1,
      }));
      // For numeric: get real values from scenario
      if (def.type === "numeric") {
        const scenario = buildScenario();
        for (const entry of entries) {
          const s = scenario.find((x) => x.edit.id === entry.id);
          if (s) entry.value = s.edit.value;
        }
      }
      const res = mergeConcurrent(def.type, entries, def.tolerance);
      expectedDisputed = res.disputed ? 1 : 0;
    }

    return { heads, nonHeads, expectedDisputed };
  }

  console.log("\nField-by-field dispute verification against mergeConcurrent ground truth:");
  const fields = Object.keys(fieldTypes);
  let totalDisputedCountRun1 = 0;
  let totalDisputedCountRun2 = 0;

  for (const fieldId of fields) {
    const eval1 = evaluateExpectedFieldDisputes(fieldId, run1.dbEdits);
    const eval2 = evaluateExpectedFieldDisputes(fieldId, run2.dbEdits);

    // Verify non-heads are disputed = 0
    for (const nh of eval1.nonHeads) {
      if (nh.disputed !== 0) {
        throw new Error(`Field ${fieldId}: non-head ${nh.edit_id} has disputed=${nh.disputed}`);
      }
    }
    // Verify heads match expectedDisputed
    for (const h of eval1.heads) {
      if (h.disputed !== eval1.expectedDisputed) {
        throw new Error(`Run 1: Field ${fieldId}: head ${h.edit_id} disputed=${h.disputed}, expected=${eval1.expectedDisputed}`);
      }
      if (h.disputed === 1) totalDisputedCountRun1++;
    }
    for (const h of eval2.heads) {
      if (h.disputed !== eval2.expectedDisputed) {
        throw new Error(`Run 2: Field ${fieldId}: head ${h.edit_id} disputed=${h.disputed}, expected=${eval2.expectedDisputed}`);
      }
      if (h.disputed === 1) totalDisputedCountRun2++;
    }

    console.log(
      `  - ${fieldId.padEnd(18)}: heads=${eval1.heads.length}, nonHeads=${eval1.nonHeads.length}, disputedHeads=${eval1.expectedDisputed === 1 ? eval1.heads.length : 0}`
    );
  }

  console.log(`\nTotal disputed edits in Run 1: ${totalDisputedCountRun1}`);
  console.log(`Total disputed edits in Run 2: ${totalDisputedCountRun2}`);

  if (totalDisputedCountRun1 !== 8 || totalDisputedCountRun2 !== 8) {
    throw new Error(`Expected exactly 8 disputed edits, got Run 1: ${totalDisputedCountRun1}, Run 2: ${totalDisputedCountRun2}`);
  }

  // Compare dispute state across runs
  const map1 = new Map(run1.dbEdits.map((e) => [e.edit_id, e.disputed]));
  const map2 = new Map(run2.dbEdits.map((e) => [e.edit_id, e.disputed]));

  for (const [id, disp1] of map1) {
    const disp2 = map2.get(id);
    if (disp1 !== disp2) {
      throw new Error(`Seed dispute mismatch for edit ${id}: Run 1=${disp1} vs Run 2=${disp2}`);
    }
  }

  console.log("  [PASS] Dispute states match mergeConcurrent() and are 100% IDENTICAL across seeds!");

  console.log("\n========================================================================");
  console.log("  ALL MERGE CORRECTNESS & CHAOS CONVERGENCE TESTS PASSED!");
  console.log("========================================================================");
}

main().catch((err) => {
  console.error("FATAL: Merge correctness test failed:", err);
  process.exit(1);
});
