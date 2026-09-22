CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('technician','supervisor','auditor'))
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  title TEXT NOT NULL,
  site TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  -- Set when a supervisor or auditor signs the inspection off; cleared only
  -- by an auditor re-opening it. NULL means still being worked on.
  finalized_at INTEGER,
  finalized_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS yjs_documents (
  doc_name TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS yjs_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_name TEXT NOT NULL,
  update_blob BLOB NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_yjs_updates_doc ON yjs_updates(doc_name);

CREATE TABLE IF NOT EXISTS edits (
  edit_id TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT,
  author TEXT NOT NULL,
  device TEXT NOT NULL,
  hlc TEXT NOT NULL,
  parents TEXT,
  schema_version INTEGER NOT NULL,
  disputed INTEGER NOT NULL DEFAULT 0,
  -- An edit that reached the server after the inspection was finalized:
  -- kept for the audit trail, but excluded from the merged value so a late
  -- offline phone cannot move a signed-off reading.
  post_finalize INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_edits_inspection ON edits(inspection_id);

CREATE TABLE IF NOT EXISTS photos (
  hash TEXT PRIMARY KEY,
  inspection_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  verified_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS field_defs (
  inspection_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  type TEXT NOT NULL,
  tolerance REAL,
  PRIMARY KEY (inspection_id, field_id)
);

