import * as Y from "yjs";
import type { EditEntry } from "@fieldmesh/shared";
import { db } from "../db/index.js";

const insertEditStmt = db.prepare(`
  INSERT OR IGNORE INTO edits (
    edit_id,
    inspection_id,
    field_id,
    value,
    author,
    device,
    hlc,
    parents,
    schema_version,
    post_finalize
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING field_id
`);

const finalizedStmt = db.prepare(
  "SELECT finalized_at FROM inspections WHERE id = ?"
);

const insertEditsTx = db.transaction(
  (inspectionId: string, entries: Array<{ id: string; entry: Partial<EditEntry> }>) => {
    const newFieldIds = new Set<string>();

    // A phone that was offline when the inspection was signed off still pushes
    // its edits on reconnect. They are kept — losing them would defeat the
    // audit trail — but stamped so the merge ignores them and a reviewer can
    // see what arrived late.
    const inspection = finalizedStmt.get(inspectionId) as
      | { finalized_at: number | null }
      | undefined;
    const postFinalize = inspection?.finalized_at ? 1 : 0;

    for (const { id, entry } of entries) {
      const fieldId = entry.fieldId;
      if (!id || !fieldId) continue;

      const valStr =
        entry.value !== undefined && entry.value !== null
          ? String(entry.value)
          : null;
      const parentsJson = JSON.stringify(entry.parents ?? []);

      const res = insertEditStmt.get(
        id,
        inspectionId,
        fieldId,
        valStr,
        entry.author ?? "",
        entry.device ?? "",
        entry.hlc ?? "",
        parentsJson,
        entry.schemaVersion ?? 1,
        postFinalize
      ) as { field_id: string } | undefined;

      if (res?.field_id) {
        newFieldIds.add(res.field_id);
      }
    }

    return Array.from(newFieldIds).map((fieldId) => ({
      inspectionId,
      fieldId,
    }));
  }
);

/**
 * Extracts newly inserted edits from the Y.Doc's top-level "edits" Y.Map,
 * persists them into SQLite `edits` table with INSERT OR IGNORE, and returns
 * the deduped list of { inspectionId, fieldId } pairs that received new edits.
 */
export function extractNewEdits(
  documentName: string,
  document: Y.Doc
): Array<{ inspectionId: string; fieldId: string }> {
  const match = documentName.match(/^inspection:(.+)$/);
  if (!match) {
    return [];
  }
  const inspectionId = match[1];

  const editsMap = document.getMap("edits");
  if (!editsMap || editsMap.size === 0) {
    return [];
  }

  const entriesToProcess: Array<{ id: string; entry: Partial<EditEntry> }> = [];
  editsMap.forEach((val, key) => {
    if (val && typeof val === "object") {
      const entry = val as Partial<EditEntry>;
      const id = entry.id || key;
      entriesToProcess.push({ id, entry });
    }
  });

  if (entriesToProcess.length === 0) {
    return [];
  }

  return insertEditsTx(inspectionId, entriesToProcess);
}
