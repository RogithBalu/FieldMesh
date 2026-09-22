import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import { tick, encodeHlc, decodeHlc, compare, type EditEntry } from "@fieldmesh/shared";
import { getHocuspocus } from "../sync/hocuspocus.js";

const isTeamMemberStmt = db.prepare(
  "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?"
);

const inspectionTeamStmt = db.prepare(
  "SELECT team_id FROM inspections WHERE id = ?"
);

/** True if `userId` belongs to the team that owns `inspectionId`. */
function isMemberOfInspection(inspectionId: string, userId: string): boolean {
  const row = inspectionTeamStmt.get(inspectionId) as
    | { team_id: string }
    | undefined;
  if (!row) return false;
  return !!isTeamMemberStmt.get(row.team_id, userId);
}

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
           WHERE tm.user_id = ?`
        )
        .all(sub);
    }
  );

  app.post(
    "/inspections",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { teamId, title, site, schemaVersion } = req.body as any;
      const sub = (req.user as any).sub;

      if (!isTeamMemberStmt.get(teamId, sub)) {
        return reply.code(403).send({ error: "not a member of this team" });
      }

      const id = nanoid();
      db.prepare(
        "INSERT INTO inspections (id,team_id,title,site,created_by,created_at,schema_version) VALUES (?,?,?,?,?,?,?)"
      ).run(id, teamId, title, site ?? null, sub, Date.now(), schemaVersion ?? 1);
      return { id };
    }
  );

  app.get(
    "/inspections/:id",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (!isMemberOfInspection(id, sub)) {
        return reply.code(403).send({ error: "not a member of this inspection's team" });
      }
      return db.prepare("SELECT * FROM inspections WHERE id = ?").get(id);
    }
  );

  app.get(
    "/inspections/:id/history",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sub = (req.user as any).sub;
      if (!isMemberOfInspection(id, sub)) {
        return reply.code(403).send({ error: "not a member of this inspection's team" });
      }
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
      if (!isMemberOfInspection(id, sub)) {
        return reply.code(403).send({ error: "not a member of this inspection's team" });
      }
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
      if (!isMemberOfInspection(id, sub)) {
        return reply.code(403).send({ error: "not a member of this inspection's team" });
      }

      const { fieldId, value, device, schemaVersion } = req.body as {
        fieldId?: string;
        value?: unknown;
        device?: string;
        schemaVersion?: number;
      };
      if (!fieldId) {
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
        device: device ?? "server",
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
        });
      } finally {
        await directConn.disconnect();
      }

      return { editId };
    }
  );
}
