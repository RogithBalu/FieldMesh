import { db } from "../db/index.js";

const inspectionTeamStmt = db.prepare(
  "SELECT team_id FROM inspections WHERE id = ?"
);
const isTeamMemberStmt = db.prepare(
  "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?"
);

export type InspectionAccess = "ok" | "missing" | "forbidden";

/**
 * Whether `userId` may read `inspectionId`: a member of the owning team.
 * Distinguishes a missing inspection from a foreign one so routes can answer
 * 404 vs 403 instead of collapsing both into 403.
 */
export function inspectionAccess(
  inspectionId: string,
  userId: string
): InspectionAccess {
  const row = inspectionTeamStmt.get(inspectionId) as
    | { team_id: string }
    | undefined;
  if (!row) return "missing";
  return isTeamMemberStmt.get(row.team_id, userId) ? "ok" : "forbidden";
}

export function isTeamMember(teamId: string, userId: string): boolean {
  return !!isTeamMemberStmt.get(teamId, userId);
}

/** Sends the right error for a non-"ok" access result; returns true if it did. */
export function denyIfNoAccess(
  access: InspectionAccess,
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  if (access === "missing") {
    reply.code(404).send({ error: "inspection not found" });
    return true;
  }
  if (access === "forbidden") {
    reply.code(403).send({ error: "not a member of this inspection's team" });
    return true;
  }
  return false;
}
