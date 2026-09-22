import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import { isNonEmptyString, jsonBody } from "../utils/body.js";

export async function teamRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Creates a team and adds the caller as its first member.
  app.post("/teams", { onRequest: [authenticate] }, async (req, reply) => {
    const { name } = jsonBody<{ name: string }>(req);
    if (!isNonEmptyString(name)) {
      return reply.code(400).send({ error: "name required" });
    }
    const sub = (req.user as any).sub;

    const id = nanoid();
    const addMemberTx = db.transaction(() => {
      db.prepare("INSERT INTO teams (id, name) VALUES (?, ?)").run(id, name);
      db.prepare(
        "INSERT INTO team_members (team_id, user_id) VALUES (?, ?)"
      ).run(id, sub);
    });
    addMemberTx();

    return { id };
  });

  app.get("/teams", { onRequest: [authenticate] }, async (req) => {
    const sub = (req.user as any).sub;
    return db
      .prepare(
        `SELECT t.* FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ?`
      )
      .all(sub);
  });

  // Only existing members of a team may add new members to it.
  app.post(
    "/teams/:id/members",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { userId } = jsonBody<{ userId: string }>(req);
      if (!isNonEmptyString(userId)) {
        return reply.code(400).send({ error: "userId required" });
      }
      const sub = (req.user as any).sub;

      const isMember = db
        .prepare(
          "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?"
        )
        .get(id, sub);
      if (!isMember) {
        return reply.code(403).send({ error: "not a member of this team" });
      }

      const userExists = db
        .prepare("SELECT 1 FROM users WHERE id = ?")
        .get(userId);
      if (!userExists) {
        return reply.code(404).send({ error: "user not found" });
      }

      db.prepare(
        "INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)"
      ).run(id, userId);

      return reply.code(204).send();
    }
  );
}
