import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import { isNonEmptyString, jsonBody } from "../utils/body.js";

export async function teamRoutes(app: FastifyInstance) {
  const authenticate = (app as any).authenticate;

  // Creates a team and adds the caller as its first member.
  /**
   * Creating a team accepts a client-supplied `id` so a phone can create one
   * while offline and push it on reconnect. Both inserts are OR IGNORE, which
   * makes a replayed create a no-op instead of a duplicate — the phone's queue
   * may well send the same request twice after a flaky link.
   */
  app.post("/teams", { onRequest: [authenticate] }, async (req, reply) => {
    const { name, id: clientId } = jsonBody<{ name: string; id?: string }>(req);
    if (!isNonEmptyString(name)) {
      return reply.code(400).send({ error: "name required" });
    }
    if (clientId !== undefined && !isNonEmptyString(clientId)) {
      return reply.code(400).send({ error: "id must be a non-empty string" });
    }
    const sub = (req.user as any).sub;
    const id = clientId ?? nanoid();

    // A replay must not let someone else's team id be claimed, nor rename one.
    const existing = db
      .prepare("SELECT id FROM teams WHERE id = ?")
      .get(id) as { id: string } | undefined;
    if (existing) {
      const isMember = db
        .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
        .get(id, sub);
      if (!isMember) {
        return reply.code(409).send({ error: "team id already in use" });
      }
      return { id, alreadyExisted: true };
    }

    const addMemberTx = db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)").run(id, name);
      db.prepare(
        "INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)"
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

  /**
   * Leave a team, or remove someone from it. Membership is flat — any member
   * may add anyone — so removal follows the same rule rather than inventing an
   * owner. The one guard is the last member of a team that still holds
   * inspections: letting them go would strand that work with nobody able to
   * reach it, since `GET /inspections` only returns a caller's own teams.
   */
  app.delete(
    "/teams/:id/members/:userId",
    { onRequest: [authenticate] },
    async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string };
      const sub = (req.user as any).sub;

      const isMember = db
        .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
        .get(id, sub);
      if (!isMember) {
        return reply.code(403).send({ error: "not a member of this team" });
      }

      const targetIsMember = db
        .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
        .get(id, userId);
      if (!targetIsMember) {
        return reply.code(404).send({ error: "user is not a member of this team" });
      }

      const { n: memberCount } = db
        .prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?")
        .get(id) as { n: number };
      if (memberCount === 1) {
        const { n: inspectionCount } = db
          .prepare("SELECT COUNT(*) AS n FROM inspections WHERE team_id = ?")
          .get(id) as { n: number };
        if (inspectionCount > 0) {
          return reply.code(409).send({
            error:
              "you are the last member and this team has inspections; add someone else first",
            inspections: inspectionCount,
          });
        }
      }

      db.prepare(
        "DELETE FROM team_members WHERE team_id = ? AND user_id = ?"
      ).run(id, userId);

      // An empty team with no inspections is just clutter on nobody's list.
      if (memberCount === 1) {
        db.prepare("DELETE FROM teams WHERE id = ?").run(id);
      }

      return reply.code(204).send();
    }
  );
}
