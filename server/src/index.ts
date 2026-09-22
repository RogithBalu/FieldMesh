import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerAuth } from "./auth/jwt.js";
import { authRoutes } from "./auth/routes.js";
import { inspectionRoutes } from "./inspections/routes.js";
import { photoRoutes } from "./photos/routes.js";
import { reportRoutes } from "./reports/routes.js";
import { teamRoutes } from "./teams/routes.js";
import { createHocuspocus } from "./sync/hocuspocus.js";
import { tusServer } from "./photos/tus.js";
import { log } from "./utils/logger.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await registerAuth(app);

const hocuspocus = createHocuspocus(app);
app.decorate("hocuspocus", hocuspocus);

await app.register(authRoutes);
await app.register(teamRoutes);
await app.register(inspectionRoutes);
await app.register(photoRoutes);
await app.register(reportRoutes);

app.get("/health", async () => ({ ok: true, service: "fieldmesh-server" }));

// tus writes the resumable-upload body itself; don't let Fastify's body
// parser consume the stream first, and hand the raw req/res straight through.
app.addContentTypeParser(
  "application/offset+octet-stream",
  (_req, _payload, done) => done(null)
);
function requireUploadAuth(req: import("fastify").FastifyRequest): boolean {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return false;
  try {
    app.jwt.verify(token);
    return true;
  } catch {
    return false;
  }
}

app.all("/uploads", (req, reply) => {
  if (!requireUploadAuth(req)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  tusServer.handle(req.raw, reply.raw);
  reply.hijack();
});
app.all("/uploads/*", (req, reply) => {
  if (!requireUploadAuth(req)) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  tusServer.handle(req.raw, reply.raw);
  reply.hijack();
});

await hocuspocus.listen();
log.info("Hocuspocus listening on :1234");

await app.listen({ port: config.port, host: "0.0.0.0" });
log.info(`REST on http://localhost:${config.port}`);
