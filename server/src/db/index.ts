import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

mkdirSync(dirname(config.databaseUrl), { recursive: true });

export const db = new Database(config.databaseUrl);
db.pragma("journal_mode = WAL");

const here = dirname(fileURLToPath(import.meta.url));
db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

/**
 * Columns added after a release. `schema.sql` carries them for a fresh
 * database; `CREATE TABLE IF NOT EXISTS` leaves an existing one untouched, so
 * they are added here instead. Guarded by PRAGMA because SQLite has no
 * "ADD COLUMN IF NOT EXISTS", and this runs on every boot.
 */
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing("inspections", "finalized_at", "INTEGER");
addColumnIfMissing("inspections", "finalized_by", "TEXT REFERENCES users(id)");
addColumnIfMissing("edits", "post_finalize", "INTEGER NOT NULL DEFAULT 0");
