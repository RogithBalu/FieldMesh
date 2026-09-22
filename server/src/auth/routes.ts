import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { nanoid } from "nanoid";
import { isNonEmptyString, jsonBody } from "../utils/body.js";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "./password.js";

interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

// Mirrors the CHECK constraint on users.role in schema.sql.
const ROLES = ["technician", "supervisor", "auditor"] as const;
type Role = (typeof ROLES)[number];

const selectByEmailStmt = db.prepare(
  "SELECT id, name, email, role, password_hash FROM users WHERE email = ?"
);
const selectByIdStmt = db.prepare(
  "SELECT id, name, email, role FROM users WHERE id = ?"
);
const insertUserStmt = db.prepare(
  "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)"
);

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Sign up: creates the user with a scrypt-hashed password and returns a
   * token straight away so the app can proceed without a second call.
   * Role defaults to technician; supervisor/auditor can be chosen here for
   * the demo, since there is no admin flow to promote users.
   */
  app.post("/auth/signup", async (req, reply) => {
    const { email, name, password, role } = jsonBody<{
      email: string;
      name: string;
      password: string;
      role?: string;
    }>(req);

    if (!isNonEmptyString(email) || !isEmail(email.trim())) {
      return reply.code(400).send({ error: "valid email required" });
    }
    if (!isNonEmptyString(name)) {
      return reply.code(400).send({ error: "name required" });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return reply
        .code(400)
        .send({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const chosenRole: Role = (role ?? "technician") as Role;
    if (!ROLES.includes(chosenRole)) {
      return reply
        .code(400)
        .send({ error: `role must be one of ${ROLES.join(", ")}` });
    }

    const normalised = normaliseEmail(email);
    if (selectByEmailStmt.get(normalised)) {
      return reply.code(409).send({ error: "email already registered" });
    }

    const id = nanoid();
    const passwordHash = await hashPassword(password);
    try {
      insertUserStmt.run(id, name.trim(), normalised, passwordHash, chosenRole);
    } catch (err: any) {
      // Two concurrent sign-ups for the same email race past the check above.
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return reply.code(409).send({ error: "email already registered" });
      }
      throw err;
    }

    const user: PublicUser = { id, name: name.trim(), email: normalised, role: chosenRole };
    const token = await reply.jwtSign({ sub: id, role: chosenRole });
    return reply.code(201).send({ token, user });
  });

  /**
   * Sign in: verifies the password against the stored hash. Unknown email
   * and wrong password both answer 401 with the same message so the endpoint
   * cannot be used to probe which emails are registered.
   */
  app.post("/auth/login", async (req, reply) => {
    const { email, password } = jsonBody<{ email: string; password: string }>(req);
    if (!isNonEmptyString(email)) {
      return reply.code(400).send({ error: "email required" });
    }
    if (!isNonEmptyString(password)) {
      return reply.code(400).send({ error: "password required" });
    }

    const row = selectByEmailStmt.get(normaliseEmail(email)) as
      | (PublicUser & { password_hash: string })
      | undefined;
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!row || !ok) {
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const user: PublicUser = { id: row.id, name: row.name, email: row.email, role: row.role };
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
      const user = selectByIdStmt.get(sub) as PublicUser | undefined;
      if (!user) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const token = await reply.jwtSign({ sub: user.id, role: user.role });
      return { token, user };
    }
  );

  /** The caller's own profile, for the app to restore a session on launch. */
  app.get(
    "/auth/me",
    { onRequest: [(app as any).authenticate] },
    async (req, reply) => {
      const sub = (req.user as any).sub as string;
      const user = selectByIdStmt.get(sub) as PublicUser | undefined;
      if (!user) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      return { user };
    }
  );
}
