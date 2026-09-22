import {
  decodeHlc,
  compare,
  mergeConcurrent,
  type EditEntry,
  type FieldType,
} from "@fieldmesh/shared";
import { db } from "../db/index.js";
import { log } from "../utils/logger.js";

const warnedMissingFieldDefs = new Set<string>();

interface EditRow {
  edit_id: string;
  field_id: string;
  value: string | null;
  author: string;
  device: string;
  hlc: string;
  parents: string;
  schema_version: number;
  disputed: number;
}

interface ParsedEdit extends Omit<EditRow, "parents"> {
  parents: string[];
}

interface FieldDefRow {
  type: string;
  tolerance: number | null;
}

const selectEditsStmt = db.prepare(`
  SELECT edit_id, field_id, value, author, device, hlc, parents, schema_version, disputed
  FROM edits
  WHERE inspection_id = ? AND field_id = ?
`);

const selectFieldDefStmt = db.prepare(`
  SELECT type, tolerance
  FROM field_defs
  WHERE inspection_id = ? AND field_id = ?
`);

const updateDisputedStmt = db.prepare(`
  UPDATE edits
  SET disputed = ?
  WHERE edit_id = ?
`);

const applyDisputesTx = db.transaction(
  (
    headEdits: ParsedEdit[],
    nonHeadIds: string[],
    fieldType: FieldType,
    tolerance?: number
  ) => {
    // 1. Settled history: non-heads are always disputed = 0
    for (const id of nonHeadIds) {
      updateDisputedStmt.run(0, id);
    }

    // 2. If there are no heads or a single head, there is no conflict
    if (headEdits.length <= 1) {
      for (const head of headEdits) {
        updateDisputedStmt.run(0, head.edit_id);
      }
      return;
    }

    // 3. Multiple concurrent heads: evaluate mergeConcurrent
    const entries: EditEntry[] = headEdits.map((h) => ({
      id: h.edit_id,
      fieldId: h.field_id,
      value: h.value,
      author: h.author,
      device: h.device,
      hlc: h.hlc,
      parents: h.parents,
      schemaVersion: h.schema_version,
    }));

    const result = mergeConcurrent(fieldType, entries, tolerance);
    const disputedFlag = result.disputed ? 1 : 0;

    for (const head of headEdits) {
      updateDisputedStmt.run(disputedFlag, head.edit_id);
    }
  }
);

/**
 * Recomputes the DAG heads and dispute status for a given (inspectionId, fieldId).
 * - Non-head edits are settled history (disputed = 0).
 * - If there is only one edit or one head, disputed = 0.
 * - If there are multiple heads, mergeConcurrent() decides whether they are disputed.
 */
export function recomputeDisputes(
  inspectionId: string,
  fieldId: string
): void {
  const rawRows = selectEditsStmt.all(inspectionId, fieldId) as EditRow[];
  if (rawRows.length === 0) {
    return;
  }

  // If there's only one edit total for this field, skip mergeConcurrent and set disputed = 0 directly
  if (rawRows.length === 1) {
    updateDisputedStmt.run(0, rawRows[0].edit_id);
    return;
  }

  // Parse parents and sort by HLC in JS using decodeHlc + compare
  const edits: ParsedEdit[] = rawRows.map((r) => {
    let parents: string[] = [];
    try {
      parents = JSON.parse(r.parents || "[]");
    } catch {
      parents = [];
    }
    return { ...r, parents };
  });

  edits.sort((a, b) => compare(decodeHlc(a.hlc), decodeHlc(b.hlc)));

  // Collect parent IDs across all edits
  const parentSet = new Set<string>();
  for (const edit of edits) {
    for (const p of edit.parents) {
      parentSet.add(p);
    }
  }

  // Partition into heads (not in parentSet) and non-heads (in parentSet)
  const headEdits: ParsedEdit[] = [];
  const nonHeadIds: string[] = [];

  for (const edit of edits) {
    if (parentSet.has(edit.edit_id)) {
      nonHeadIds.push(edit.edit_id);
    } else {
      headEdits.push(edit);
    }
  }

  // Determine field type and tolerance
  let fieldType: FieldType = "short_text";
  let tolerance: number | undefined;

  const defRow = selectFieldDefStmt.get(
    inspectionId,
    fieldId
  ) as FieldDefRow | undefined;

  if (defRow && defRow.type) {
    fieldType = defRow.type as FieldType;
    tolerance = defRow.tolerance != null ? Number(defRow.tolerance) : undefined;
  } else {
    const key = `${inspectionId}:${fieldId}`;
    if (!warnedMissingFieldDefs.has(key)) {
      warnedMissingFieldDefs.add(key);
      log.warn(
        `No field_def found for inspection="${inspectionId}", field="${fieldId}". Defaulting to "short_text".`
      );
    }
  }

  applyDisputesTx(headEdits, nonHeadIds, fieldType, tolerance);
}
