// Real-shaped SQL: the planned 0001-0004 migrations (stories 2, 5, 7, 8) plus dangerous variants.

export const SAFE_0001_WORKSPACES = `-- Migration number: 0001 workspaces
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

export const SAFE_0002_TASKS = `-- Migration number: 0002 tasks
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

export const SAFE_0003_PROJECTS = `-- Migration number: 0003 projects
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
  deleted_at TEXT
);
ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT;
CREATE INDEX idx_projects_ws ON projects(workspace_id, deleted, sort_order);
CREATE INDEX idx_tasks_project ON tasks(workspace_id, project_id, deleted, completed_at, sort_order);
CREATE INDEX idx_tasks_batch ON tasks(delete_batch_id);
`;

export const SAFE_0004_DUE_DATE = `-- Migration number: 0004 task due date
ALTER TABLE tasks ADD COLUMN due_date TEXT;
CREATE INDEX idx_tasks_ws_due ON tasks(workspace_id, deleted, completed_at, due_date);
`;

/** One file per dangerous pattern; the offending statement is on line 2. */
export const DANGEROUS_BY_PATTERN: { pattern: string; sql: string }[] = [
  {
    pattern: 'CHECK (',
    sql: `-- Migration number: 0005 name length\nCREATE TABLE labels (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) <= 120));\n`,
  },
  { pattern: 'DROP TABLE', sql: `-- Migration number: 0005 drop projects\nDROP TABLE projects;\n` },
  { pattern: 'TRUNCATE TABLE', sql: `-- Migration number: 0005 clear tasks\nTRUNCATE TABLE tasks;\n` },
  {
    pattern: 'ALTER TABLE .. MODIFY',
    sql: `-- Migration number: 0005 widen name\nALTER TABLE tasks MODIFY name TEXT NOT NULL;\n`,
  },
  {
    pattern: 'ALTER TABLE .. CHANGE',
    sql: `-- Migration number: 0005 rename name\nALTER TABLE tasks CHANGE name title TEXT;\n`,
  },
  {
    pattern: 'ADD CONSTRAINT',
    sql: `-- Migration number: 0005 unique names\nALTER TABLE projects ADD CONSTRAINT uq_projects_name UNIQUE (workspace_id, name);\n`,
  },
  {
    pattern: 'DROP CONSTRAINT',
    sql: `-- Migration number: 0005 drop fk\nALTER TABLE tasks DROP CONSTRAINT fk_tasks_projects;\n`,
  },
];

/** SQLite table-rebuild idiom: create _new, copy, drop the original, rename. */
export const REBUILD_WITH_TEMP_TABLES = `-- Migration number: 0006 rebuild tasks
CREATE TABLE tasks_new (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL);
INSERT INTO tasks_new SELECT id, workspace_id, name FROM tasks;
DROP TABLE IF EXISTS tasks_backup;
DROP TABLE tasks_old;
`;
