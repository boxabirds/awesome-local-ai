// Real-shaped SQL from the planned migrations 0001-0004, plus dangerous variants.

export const M0001_WORKSPACES = `-- Migration number: 0001 \t 2026-09-25T18:00:00.000Z
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
`;

export const M0002_TASKS = `-- Migration number: 0002 \t 2026-09-25T18:10:00.000Z
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
`;

export const M0003_PROJECTS = `-- Migration number: 0003 \t 2026-09-25T18:20:00.000Z
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  delete_batch_id TEXT
);
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT;
CREATE INDEX idx_projects_ws ON projects(workspace_id, deleted, sort_order);
CREATE INDEX idx_tasks_project ON tasks(workspace_id, project_id, deleted, completed_at, sort_order);
CREATE INDEX idx_tasks_batch ON tasks(delete_batch_id);
`;

export const M0004_DUE_DATE = `-- Migration number: 0004 \t 2026-09-25T18:30:00.000Z
ALTER TABLE tasks ADD COLUMN due_date TEXT;
CREATE INDEX idx_tasks_ws_due ON tasks(workspace_id, deleted, completed_at, due_date);
`;

/** One dangerous statement per pattern in DANGEROUS_MIGRATION_PATTERNS. */
export const DANGEROUS_BY_PATTERN: Record<string, string> = {
  'CHECK (': `ALTER TABLE tasks ADD COLUMN priority INTEGER CHECK (priority BETWEEN 1 AND 3);`,
  'DROP TABLE': `DROP TABLE tasks;`,
  'TRUNCATE TABLE': `TRUNCATE TABLE tasks;`,
  'ALTER TABLE .. MODIFY': `ALTER TABLE tasks MODIFY name TEXT NOT NULL;`,
  'ALTER TABLE .. CHANGE': `ALTER TABLE tasks CHANGE name title TEXT;`,
  'ADD CONSTRAINT': `ALTER TABLE tasks ADD CONSTRAINT fk_ws FOREIGN KEY (workspace_id) REFERENCES workspaces(id);`,
  'DROP CONSTRAINT': `ALTER TABLE tasks DROP CONSTRAINT fk_ws;`,
};
