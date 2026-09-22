import { Server } from "@hocuspocus/server";
import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { onLoadDocument, onChange, onStoreDocument } from "./persist.js";

export function createHocuspocus(app: FastifyInstance) {
  return Server.configure({
    port: 1234,
    async onAuthenticate({ token, documentName }) {
      if (!token) {
        throw new Error("unauthorized");
      }

      let payload: { sub: string; role?: string; [key: string]: any };
      try {
        payload = app.jwt.verify(token);
      } catch {
        throw new Error("unauthorized");
      }

      const match = documentName.match(/^inspection:(.+)$/);
      if (!match) {
        throw new Error("unauthorized");
      }
      const inspectionId = match[1];

      const membership = db
        .prepare(
          `SELECT 1 FROM inspections i
           JOIN team_members tm ON tm.team_id = i.team_id
           WHERE i.id = ? AND tm.user_id = ?`
        )
        .get(inspectionId, payload.sub);

      if (!membership) {
        throw new Error("unauthorized");
      }

      return {
        user: payload,
      };
    },
    onLoadDocument,
    onChange,
    onStoreDocument,
  });
}
