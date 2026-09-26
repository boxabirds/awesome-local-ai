-- Story 5: tasks. Ids are client-generated (32 lowercase hex), so `id` has no DEFAULT: a create is
-- idempotent on its id. The Inbox is not a row: it is every task with no project (story 7 adds project_id).
-- Length limits are enforced by the shared zod schemas (the server is the final guard).
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order REAL NOT NULL,
  completed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE INDEX idx_tasks_ws_open ON tasks(workspace_id, deleted, completed_at, sort_order);
