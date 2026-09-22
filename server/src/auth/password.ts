import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

// Hand-rolled instead of promisify: the options overload is not the one
// promisify's typings pick.
function scrypt(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: { N: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLen, options, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

// Stored format: scrypt$<N>$<salt hex>$<hash hex>. Keeping the cost in the
// string lets it be raised later without invalidating existing rows.
const COST = 16384;
const KEY_LEN = 64;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N: COST });
  return `scrypt$${COST}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time check; false for any malformed or legacy placeholder hash. */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) {
    return false;
  }
  const key = await scrypt(password, salt, expected.length, { N: cost });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
