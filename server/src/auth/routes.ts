import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";

// Passwordless-by-design for the demo: any email logs in, auto-creating a
// user on first sight. No password is ever checked against `password_hash`
// (still stored as the literal string "placeholder"). This is a deliberate
// scope cut for the MVP demo window, not an oversight — see docs/TODO.md.
export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { email, name } = req.body as { email: string; name?: string };
    if (!email) return reply.code(400).send({ error: "email required" });

    let user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as any;

    if (!user) {
      const id = nanoid();
      db.prepare(
        "INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)"
      ).run(id, name ?? email, email, "placeholder", "technician");
      user = { id, email, role: "technician" };
    }

    const token = await reply.jwtSign({ sub: user.id, role: user.role });
    return { token, user };
  });

  app.post(
    "/auth/refresh",
    { onRequest: [(app as any).authenticate] },
    async (req, reply) => {
      const sub = (req.user as any).sub;
      const token = await reply.jwtSign({ sub });
      return { token };
    }
  );
}
