import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import { isNonEmptyString, jsonBody } from "../utils/body.js";

interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const selectUserStmt = db.prepare(
  "SELECT id, name, email, role FROM users WHERE email = ?"
);
const selectUserByIdStmt = db.prepare(
  "SELECT id, name, email, role FROM users WHERE id = ?"
);

// Passwordless-by-design for the demo: any email logs in, auto-creating a
// user on first sight. No password is ever checked against `password_hash`
// (still stored as the literal string "placeholder"). This is a deliberate
// scope cut for the MVP demo window, not an oversight — see docs/TODO.md.
export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { email, name } = jsonBody<{ email: string; name?: string }>(req);
    if (!isNonEmptyString(email)) {
      return reply.code(400).send({ error: "email required" });
    }

    let user = selectUserStmt.get(email) as PublicUser | undefined;

    if (!user) {
      const id = nanoid();
      const displayName = isNonEmptyString(name) ? name : email;
      db.prepare(
        "INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)"
      ).run(id, displayName, email, "placeholder", "technician");
      user = { id, name: displayName, email, role: "technician" };
    }

    const token = await reply.jwtSign({ sub: user.id, role: user.role });
    return { token, user };
  });

  // Re-reads the user so a role change since the old token was issued is
  // reflected, and so the new token carries the same claims as a login.
  app.post(
    "/auth/refresh",
    { onRequest: [(app as any).authenticate] },
    async (req, reply) => {
      const sub = (req.user as any).sub as string;
      const user = selectUserByIdStmt.get(sub) as PublicUser | undefined;
      if (!user) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const token = await reply.jwtSign({ sub: user.id, role: user.role });
      return { token, user };
    }
  );
}
