import { db } from "../db/index.js";

export type Role = "technician" | "supervisor" | "auditor";

/**
 * Settling a dispute and finalizing an inspection are sign-off actions: a
 * technician records findings, a supervisor or auditor stands behind them.
 */
export const REVIEWER_ROLES: readonly Role[] = ["supervisor", "auditor"];

/**
 * Re-opening a finalized inspection undoes a sign-off, so it sits with the
 * auditor alone — a supervisor cannot reverse their own finalization.
 */
export const REOPEN_ROLES: readonly Role[] = ["auditor"];

const roleStmt = db.prepare("SELECT role FROM users WHERE id = ?");

/**
 * The caller's role as the database has it now, not as their token claims.
 * A JWT issued before a demotion would otherwise keep its old authority until
 * it expired.
 */
export function roleOf(userId: string): Role | null {
  const row = roleStmt.get(userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

/** Sends 403 unless the caller holds one of `allowed`; returns true if it did. */
export function denyUnlessRole(
  userId: string,
  allowed: readonly Role[],
  reply: { code: (c: number) => { send: (b: unknown) => unknown } }
): boolean {
  const role = roleOf(userId);
  if (role && allowed.includes(role)) return false;
  reply.code(403).send({
    error: `this action requires ${allowed.join(" or ")}`,
    role,
  });
  return true;
}
