import type { FastifyInstance } from "fastify";
import { compare, decodeHlc } from "@fieldmesh/shared";
import { db } from "../db/index.js";
import { denyIfNoAccess, inspectionAccess } from "../inspections/access.js";

interface EditRow {
  edit_id: string;
  field_id: string;
  value: string | null;
  author: string;
  device: string;
  hlc: string;
  parents: string | null;
  disputed: number;
}

interface FieldReport {
  value: string | null;
  disputed: boolean;
  /** Every current head; more than one means the field is still contested. */
  heads: Array<{ editId: string; value: string | null; author: string; device: string; hlc: string }>;
  lastEditedBy: string;
  lastEditedAt: number;
  edits: number;
}

const selectInspectionStmt = db.prepare("SELECT * FROM inspections WHERE id = ?");
const selectEditsStmt = db.prepare(
  "SELECT edit_id, field_id, value, author, device, hlc, parents, disputed FROM edits WHERE inspection_id = ?"
);
const selectPhotosStmt = db.prepare(
  "SELECT hash, size, uploaded_by, verified_at FROM photos WHERE inspection_id = ? ORDER BY verified_at"
);

/**
 * Folds the edit log into one entry per field: the current heads (edits no
 * later edit names as a parent), the winning value by HLC, and whether the
 * server still flags the field as disputed. Same head rule as disputes.ts.
 */
function summariseFields(rows: EditRow[]): Record<string, FieldReport> {
  const byField = new Map<string, EditRow[]>();
  for (const r of rows) {
    const list = byField.get(r.field_id) ?? [];
    list.push(r);
    byField.set(r.field_id, list);
  }

  const out: Record<string, FieldReport> = {};
  for (const [fieldId, edits] of byField) {
    const superseded = new Set<string>();
    for (const e of edits) {
      let parents: string[] = [];
      try {
        parents = JSON.parse(e.parents || "[]");
      } catch {
        parents = [];
      }
      for (const p of parents) superseded.add(p);
    }
    const heads = edits
      .filter((e) => !superseded.has(e.edit_id))
      .sort((a, b) => compare(decodeHlc(a.hlc), decodeHlc(b.hlc)));
    const latest = heads[heads.length - 1] ?? edits[edits.length - 1];

    out[fieldId] = {
      value: latest.value,
      disputed: heads.some((h) => h.disputed === 1),
      heads: heads.map((h) => ({
        editId: h.edit_id,
        value: h.value,
        author: h.author,
        device: h.device,
        hlc: h.hlc,
      })),
      lastEditedBy: latest.author,
      lastEditedAt: decodeHlc(latest.hlc).wall,
      edits: edits.length,
    };
  }
  return out;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get(
    "/inspections/:id/report",
    { onRequest: [(app as any).authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (denyIfNoAccess(inspectionAccess(id, sub), reply)) return;

      const inspection = selectInspectionStmt.get(id);
      const edits = selectEditsStmt.all(id) as EditRow[];
      const photos = (selectPhotosStmt.all(id) as any[]).map((p) => ({
        hash: p.hash,
        size: p.size,
        uploadedBy: p.uploaded_by,
        verifiedAt: p.verified_at,
      }));
      const fields = summariseFields(edits);
      const disputedFields = Object.values(fields).filter((f) => f.disputed).length;

      return {
        inspection,
        generatedAt: Date.now(),
        fields,
        photos,
        summary: {
          edits: edits.length,
          fields: Object.keys(fields).length,
          disputedFields,
          photos: photos.length,
        },
      };
    }
  );
}
