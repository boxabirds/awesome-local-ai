-- Story 2: secret-link workspaces. Only SHA-256(secret) is stored, never the secret itself.
-- No CHECK constraints: name length is validated in the app.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  secret_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
