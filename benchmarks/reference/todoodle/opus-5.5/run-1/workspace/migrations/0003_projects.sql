-- Story 7: projects. Ids are client-generated (32 lowercase hex), so `id` has no DEFAULT and a create is
-- idempotent on its id. `color` stores a palette KEY (e.g. 'berry'), never a hex value, so the palette's
-- light/dark values can be retuned without a migration; the shared zod schemas validate it.
-- Soft delete: `delete_batch_id` names the deletion, so undo restores exactly the rows it removed.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  delete_batch_id TEXT
);

-- NULL project_id = Inbox, so every existing task stays in the Inbox.
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
-- Set only when a task is deleted together with its project; NULL for tasks deleted on their own.
ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT;

CREATE INDEX idx_projects_ws ON projects(workspace_id, deleted, sort_order);
CREATE INDEX idx_tasks_project ON tasks(workspace_id, project_id, deleted, completed_at, sort_order);
CREATE INDEX idx_tasks_batch ON tasks(delete_batch_id);
