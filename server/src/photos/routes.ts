import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db/index.js";
import { config } from "../config.js";

export async function photoRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  app.head("/photos/:hash", { onRequest: [authenticate] }, async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const row = db.prepare("SELECT 1 FROM photos WHERE hash = ?").get(hash);
    reply.code(row ? 200 : 404).send();
  });

  app.get("/photos/:hash", { onRequest: [authenticate] }, async (req, reply) => {
    const { hash } = req.params as { hash: string };
    const row = db
      .prepare("SELECT storage_key, size FROM photos WHERE hash = ?")
      .get(hash) as { storage_key: string; size: number } | undefined;
    if (!row) return reply.code(404).send();

    const filePath = join(config.uploadsDir, row.storage_key);
    if (!existsSync(filePath)) {
      // Row exists but the file is gone from disk — data integrity problem,
      // not a plain 404.
      return reply.code(410).send({ error: "photo record exists but file is missing" });
    }

    const stat = statSync(filePath);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", stat.size);
    reply.header("Cache-Control", "public, max-age=31536000, immutable"); // content-addressed by hash, safe to cache forever
    return reply.send(createReadStream(filePath));
  });
}
