-- Story 2: secret-link workspaces. Only SHA-256(secret) is stored; the raw secret never is.
-- The Inbox is implicit (tasks with project_id IS NULL), so no Inbox row exists.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  secret_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
