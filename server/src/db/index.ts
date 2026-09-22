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
