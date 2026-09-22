import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import {
  tick,
  encodeHlc,
  decodeHlc,
  compare,
  type EditEntry,
  type FieldType,
} from "@fieldmesh/shared";
import { getHocuspocus } from "../sync/hocuspocus.js";
import { denyIfNoAccess, inspectionAccess, isTeamMember } from "./access.js";
import { isNonEmptyString, jsonBody } from "../utils/body.js";

// Mirrors FieldType in shared/src/schema.ts; the dispute engine only knows
// how to merge these.
const FIELD_TYPES: readonly FieldType[] = [
  "pass_fail",
  "numeric",
  "notes",
  "photo",
  "short_text",
];

interface FieldDefInput {
  id: string;
  type: FieldType;
  tolerance?: number;
}

const selectFieldDefsStmt = db.prepare(
  "SELECT field_id AS id, type, tolerance FROM field_defs WHERE inspection_id = ? ORDER BY rowid"
);
const insertFieldDefStmt = db.prepare(
  "INSERT OR REPLACE INTO field_defs (inspection_id, field_id, type, tolerance) VALUES (?, ?, ?, ?)"
);

/**
 * Validates the optional `fields` array on inspection creation. Returns the
 * cleaned list, or an error message. Without field defs the dispute engine
 * (edits/disputes.ts) falls back to "short_text" for every field, which means
 * numeric tolerance and the photo "keep all" rule never apply.
 */
function parseFieldDefs(raw: unknown): { fields: FieldDefInput[] } | { error: string } {
  if (raw === undefined || raw === null) return { fields: [] };
  if (!Array.isArray(raw)) return { error: "fields must be an array" };
  const fields: FieldDefInput[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== "object") return { error: "each field must be an object" };
    const { id, type, tolerance } = f as Record<string, unknown>;
    if (!isNonEmptyString(id)) return { error: "field id required" };
    if (!FIELD_TYPES.includes(type as FieldType)) {
      return { error: `field type must be one of ${FIELD_TYPES.join(", ")}` };
    }
    if (tolerance !== undefined && tolerance !== null && !Number.isFinite(Number(tolerance))) {
      return { error: "field tolerance must be a number" };
    }
    if (seen.has(id)) return { error: `duplicate field id ${id}` };
    seen.add(id);
    fields.push({
      id,
      type: type as FieldType,
      tolerance: tolerance === undefined || tolerance === null ? undefined : Number(tolerance),
    });
  }
  return { fields };
}

const insertInspectionTx = db.transaction(
  (
    id: string,
    teamId: string,
    title: string,
    site: string | null,
    createdBy: string,
    schemaVersion: number,
    fields: FieldDefInput[]
  ) => {
    db.prepare(
      "INSERT INTO inspections (id,team_id,title,site,created_by,created_at,schema_version) VALUES (?,?,?,?,?,?,?)"
    ).run(id, teamId, title, site, createdBy, Date.now(), schemaVersion);
    for (const f of fields) {
      insertFieldDefStmt.run(id, f.id, f.type, f.tolerance ?? null);
    }
  }
);

export async function inspectionRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  app.get(
    "/inspections",
    { onRequest: [authenticate] },
    async (req) => {
      const sub = (req.user as any).sub;
      return db
        .prepare(
          `SELECT i.* FROM inspections i
           JOIN team_members tm ON tm.team_id = i.team_id
           WHERE tm.user_id = ?
           ORDER BY i.created_at DESC`
        )
        .all(sub);
    }
  );

  app.post(
    "/inspections",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { teamId, title, site, schemaVersion, fields } = jsonBody<{
        teamId: string;
        title: string;
        site?: string;
        schemaVersion?: number;
        fields?: FieldDefInput[];
      }>(req);
      const sub = (req.user as any).sub;

      if (!isNonEmptyString(teamId)) {
        return reply.code(400).send({ error: "teamId required" });
      }
      if (!isNonEmptyString(title)) {
        return reply.code(400).send({ error: "title required" });
      }
      const parsed = parseFieldDefs(fields);
      if ("error" in parsed) {
        return reply.code(400).send({ error: parsed.error });
      }

      if (!isTeamMember(teamId, sub)) {
        return reply.code(403).send({ error: "not a member of this team" });
      }

      const id = nanoid();
      insertInspectionTx(
        id,
        teamId,
        title.trim(),
        isNonEmptyString(site) ? site.trim() : null,
        sub,
        schemaVersion ?? 1,
        parsed.fields
      );
      return { id };
    }
  );

  // Returns the row plus its field definitions (empty array when the
  // inspection was created without any) so the app can render the right
  // checklist and apply the same tolerance rules the server does.
  app.get(
    "/inspections/:id",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (denyIfNoAccess(inspectionAccess(id, sub), reply)) return;
      const row = db.prepare("SELECT * FROM inspections WHERE id = ?").get(id) as
        | Record<string, unknown>
        | undefined;
      if (!row) return reply.code(404).send({ error: "inspection not found" });
      return { ...row, fields: selectFieldDefsStmt.all(id) };
    }
  );

  app.get(
    "/inspections/:id/history",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (denyIfNoAccess(inspectionAccess(id, sub), reply)) return;
      return db
        .prepare("SELECT * FROM edits WHERE inspection_id = ? ORDER BY hlc")
        .all(id);
    }
  );

  app.get(
    "/inspections/:id/disputes",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (denyIfNoAccess(inspectionAccess(id, sub), reply)) return;
      return db
        .prepare(
          "SELECT * FROM edits WHERE inspection_id = ? AND disputed = 1"
        )
        .all(id);
    }
  );

  // Supervisor resolution: writes a new edit whose parents are all current
  // disputed heads for the field, closing out the dispute. The new edit
  // becomes the sole head, so recomputeDisputes() settles it to disputed=0.
  app.post(
    "/inspections/:id/resolve",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (denyIfNoAccess(inspectionAccess(id, sub), reply)) return;

      const { fieldId, value, device, schemaVersion } = jsonBody<{
        fieldId: string;
        value: unknown;
        device: string;
        schemaVersion: number;
      }>(req);
      if (!isNonEmptyString(fieldId)) {
        return reply.code(400).send({ error: "fieldId required" });
      }

      const disputedHeads = db
        .prepare(
          "SELECT edit_id, hlc FROM edits WHERE inspection_id = ? AND field_id = ? AND disputed = 1"
        )
        .all(id, fieldId) as { edit_id: string; hlc: string }[];

      if (disputedHeads.length === 0) {
        return reply.code(409).send({ error: "no disputed edits for this field" });
      }

      const latestHlc = disputedHeads
        .map((h) => decodeHlc(h.hlc))
        .sort(compare)
        .pop()!;
      const newHlc = tick(latestHlc, "server");

      const editId = nanoid();
      const resolutionEdit: EditEntry = {
        id: editId,
        fieldId,
        value,
        author: sub,
        device: isNonEmptyString(device) ? device : "server",
        hlc: encodeHlc(newHlc),
        parents: disputedHeads.map((h) => h.edit_id),
        schemaVersion: schemaVersion ?? 1,
      };

      const hocuspocus = (app as any).hocuspocus ?? getHocuspocus();
      if (!hocuspocus) {
        return reply.code(500).send({ error: "Hocuspocus server not available" });
      }

      const directConn = await hocuspocus.openDirectConnection(`inspection:${id}`);
      try {
        await directConn.transact((doc: any) => {
          doc.getMap("edits").set(editId, resolutionEdit);
          // Keep the live "fields" map (what phones render) in step with the log.
          doc.getMap("fields").set(fieldId, value);
        });
      } finally {
        await directConn.disconnect();
      }

      return { editId };
    }
  );
}
