import * as Y from "yjs";
import type {
  onLoadDocumentPayload,
  onChangePayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import { db } from "../db/index.js";
import { extractNewEdits } from "../edits/extract.js";
import { recomputeDisputes } from "../edits/disputes.js";

/**
 * Loads the document snapshot from `yjs_documents` and applies any remaining
 * updates from `yjs_updates` in id order.
 */
export async function onLoadDocument(data: onLoadDocumentPayload) {
  const { documentName, document } = data;

  // 1. Load latest snapshot if it exists
  const snapshotRow = db
    .prepare("SELECT state FROM yjs_documents WHERE doc_name = ?")
    .get(documentName) as { state: Buffer } | undefined;

  if (snapshotRow?.state) {
    Y.applyUpdate(document, new Uint8Array(snapshotRow.state));
  }

  // 2. Apply any updates recorded in yjs_updates in id ASC order
  const updateRows = db
    .prepare(
      "SELECT update_blob FROM yjs_updates WHERE doc_name = ? ORDER BY id ASC"
    )
    .all(documentName) as { update_blob: Buffer }[];

  for (const row of updateRows) {
    Y.applyUpdate(document, new Uint8Array(row.update_blob));
  }

  return document;
}

/**
 * Appends the raw update to `yjs_updates` and triggers edit extraction and dispute detection.
 */
export async function onChange(data: onChangePayload) {
  const { documentName, update, document } = data;

  if (update && update.length > 0) {
    db.prepare(
      "INSERT INTO yjs_updates (doc_name, update_blob, received_at) VALUES (?, ?, ?)"
    ).run(documentName, Buffer.from(update), Date.now());
  }

  // Extract newly arrived edits and recompute disputes for modified fields
  const newPairs = extractNewEdits(documentName, document);
  for (const { inspectionId, fieldId } of newPairs) {
    recomputeDisputes(inspectionId, fieldId);
  }
}

/**
 * Atomic transaction to upsert snapshot into `yjs_documents` and prune
 * corresponding rows from `yjs_updates`.
 */
const persistSnapshotTx = db.transaction(
  (docName: string, document: onStoreDocumentPayload["document"]) => {
    // Capture MAX(id) for this doc before encoding
    const maxRow = db
      .prepare("SELECT MAX(id) as maxId FROM yjs_updates WHERE doc_name = ?")
      .get(docName) as { maxId: number | null } | undefined;
    const maxId = maxRow?.maxId ?? null;

    // Encode full state as update
    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    const now = Date.now();

    // Upsert into yjs_documents
    db.prepare(`
      INSERT INTO yjs_documents (doc_name, state, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(doc_name) DO UPDATE SET
        state = excluded.state,
        updated_at = excluded.updated_at
    `).run(docName, state, now);

    // Prune updates that were folded into the snapshot
    if (maxId !== null) {
      db.prepare(`
        DELETE FROM yjs_updates
        WHERE doc_name = ? AND id <= ?
      `).run(docName, maxId);
    }
  }
);

/**
 * Debounced persistence hook to write full document snapshot to SQLite.
 */
export async function onStoreDocument(data: onStoreDocumentPayload) {
  persistSnapshotTx(data.documentName, data.document);
}
