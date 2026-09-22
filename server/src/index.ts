import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerAuth } from "./auth/jwt.js";
import { authRoutes } from "./auth/routes.js";
import { inspectionRoutes } from "./inspections/routes.js";
import { photoRoutes } from "./photos/routes.js";
import { reportRoutes } from "./reports/routes.js";
import { createHocuspocus } from "./sync/hocuspocus.js";
import { tusServer } from "./photos/tus.js";
import { log } from "./utils/logger.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await registerAuth(app);

await app.register(authRoutes);
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
app.all("/uploads", (req, reply) => {
  tusServer.handle(req.raw, reply.raw);
  reply.hijack();
});
app.all("/uploads/*", (req, reply) => {
  tusServer.handle(req.raw, reply.raw);
  reply.hijack();
});

const hocuspocus = createHocuspocus(app);
await hocuspocus.listen();
log.info("Hocuspocus listening on :1234");

await app.listen({ port: config.port, host: "0.0.0.0" });
log.info(`REST on http://localhost:${config.port}`);
