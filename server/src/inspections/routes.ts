import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";

export async function inspectionRoutes(app: FastifyInstance) {
  app.get("/inspections", async () => {
    return db.prepare("SELECT * FROM inspections").all();
  });

  app.post("/inspections", async (req) => {
    const { teamId, title, site, createdBy, schemaVersion } = req.body as any;
    const id = nanoid();
    db.prepare(
      "INSERT INTO inspections (id,team_id,title,site,created_by,created_at,schema_version) VALUES (?,?,?,?,?,?,?)"
    ).run(
      id,
      teamId,
      title,
      site ?? null,
      createdBy,
      Date.now(),
      schemaVersion ?? 1
    );
    return { id };
  });

  app.get("/inspections/:id", async (req) => {
    const { id } = req.params as { id: string };
    return db.prepare("SELECT * FROM inspections WHERE id = ?").get(id);
  });

  app.get("/inspections/:id/history", async (req) => {
    const { id } = req.params as { id: string };
    return db
      .prepare("SELECT * FROM edits WHERE inspection_id = ? ORDER BY hlc")
      .all(id);
  });

  app.get("/inspections/:id/disputes", async (req) => {
    const { id } = req.params as { id: string };
    return db
      .prepare(
        "SELECT * FROM edits WHERE inspection_id = ? AND disputed = 1"
      )
      .all(id);
  });
}
