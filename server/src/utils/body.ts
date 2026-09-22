import type { FastifyRequest } from "fastify";

/**
 * The parsed JSON body, or {} when the request carried none. Fastify leaves
 * `req.body` undefined for a body-less request, and destructuring that throws
 * a 500 where the caller deserves a 400.
 */
export function jsonBody<T extends object = Record<string, unknown>>(
  req: FastifyRequest
): Partial<T> {
  const b = req.body;
  return b && typeof b === "object" ? (b as Partial<T>) : {};
}

/** True for a non-empty string; the check every required id/name field needs. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
