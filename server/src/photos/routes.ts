import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";

export async function photoRoutes(app: FastifyInstance) {
  app.head("/photos/:hash", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const row = db.prepare("SELECT 1 FROM photos WHERE hash = ?").get(hash);
    reply.code(row ? 200 : 404).send();
  });

  app.get("/photos/:hash", async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const row = db
      .prepare("SELECT storage_key FROM photos WHERE hash = ?")
      .get(hash) as any;
    if (!row) return reply.code(404).send();
    return { storageKey: row.storage_key };
  });
}
