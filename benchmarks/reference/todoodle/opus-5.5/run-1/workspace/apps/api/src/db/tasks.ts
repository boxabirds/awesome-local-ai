import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Counts, Task, TaskList, TaskPatch } from '@todoodle/shared/schemas';
import { resolvePatchedName } from '@todoodle/shared/schemas';
import type { MutationResult } from '@todoodle/shared/types';

/** A row of the `tasks` table (migrations/0002_tasks.sql). */
export type TaskRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  sort_order: number;
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted: number;
  deleted_at: string | null;
  /** Story 7: NULL = Inbox. */
  project_id: string | null;
  /** Story 7: set only when the task was deleted together with its project. */
  delete_batch_id: string | null;
};

/** Maps a stored row to the public Task shape. Only whitelisted fields are copied. */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id ?? null,
    name: row.name,
    description: row.description,
    sortOrder: Number(row.sort_order),
    completedAt: row.completed_at ?? null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type InsertTaskResult =
  | { status: 'created'; task: TaskRow }
  | { status: 'replayed'; task: TaskRow }
  | { status: 'gone' }
  | { status: 'conflict' };

/**
 * Idempotent create keyed on the client-generated id. One statement, so the MAX+step ordering is atomic
 * under D1's serialised writes. MAX spans all of the workspace's tasks (completed and deleted too), so a
 * reopened task (story 6) keeps its place without collisions. The WHERE clause also resolves SQLite's
 * INSERT ... SELECT ... ON CONFLICT parse ambiguity.
 *
 * When the id already exists nothing is written: same workspace -> replayed (stored values win) or gone
 * (soft-deleted); another workspace -> conflict.
 */
export async function insertTaskIdempotent(
  db: D1Database,
  input: { id: string; workspaceId: string; name: string; description: string; projectId?: string | null },
): Promise<InsertTaskResult> {
  const inserted = await db
    .prepare(
      `INSERT INTO tasks (id, workspace_id, name, description, sort_order, project_id)
       SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(sort_order), 0) + ?5, ?6 FROM tasks WHERE workspace_id = ?2
       ON CONFLICT(id) DO NOTHING RETURNING *`,
    )
    .bind(input.id, input.workspaceId, input.name, input.description, TASK_SORT_STEP, input.projectId ?? null)
    .first<TaskRow>();
  if (inserted) return { status: 'created', task: inserted };
  return classifyExistingTask(db, input.id, input.workspaceId);
}

/**
 * An id that is already taken, classified for a create: same workspace -> replayed (stored values win) or gone
 * (soft-deleted); another workspace -> conflict. Null when no row has the id.
 */
async function classifyExisting(db: D1Database, id: string, workspaceId: string): Promise<InsertTaskResult | null> {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  if (!existing) return null;
  if (existing.workspace_id !== workspaceId) return { status: 'conflict' };
  if (existing.deleted !== 0) return { status: 'gone' };
  return { status: 'replayed', task: existing };
}

async function classifyExistingTask(db: D1Database, id: string, workspaceId: string): Promise<InsertTaskResult> {
  // The row vanished between the two statements: nothing to replay, so report it as gone.
  return (await classifyExisting(db, id, workspaceId)) ?? { status: 'gone' };
}

/**
 * Story 7: a create whose projectId is not an active project here. A replay of an existing id still answers
 * as before (the project is only checked for rows that would be inserted); a new id is project_not_found.
 */
export async function classifyCreateWithoutProject(db: D1Database, id: string, workspaceId: string): Promise<InsertTaskResult | { status: 'project_not_found' }> {
  return (await classifyExisting(db, id, workspaceId)) ?? { status: 'project_not_found' };
}

/** Open (not completed), non-deleted tasks of a list, in order: the Inbox (no project) or one project. */
export function listOpenTasks(db: D1Database, workspaceId: string, query: { list: TaskList; projectId?: string }): Promise<TaskRow[]> {
  return listTasks(db, workspaceId, { ...query, includeCompleted: false });
}

/**
 * Task counts per list, in one statement. inbox: open, non-deleted tasks with no project. projects: every
 * active project (zeros included; deleted projects absent) with open = not completed and total = open +
 * completed, which is exactly the set a project delete removes. Story 8 adds fields.
 */
export async function countOpenTasks(db: D1Database, workspaceId: string): Promise<Counts> {
  const { results } = await db
    .prepare(
      `SELECT p.id AS pid, COALESCE(SUM(t.id IS NOT NULL AND t.completed_at IS NULL), 0) AS open, COUNT(t.id) AS total
       FROM projects p LEFT JOIN tasks t ON t.workspace_id = p.workspace_id AND t.project_id = p.id AND t.deleted = 0
       WHERE p.workspace_id = ?1 AND p.deleted = 0
       GROUP BY p.id
       UNION ALL
       SELECT NULL AS pid, COUNT(*) AS open, COUNT(*) AS total
       FROM tasks WHERE workspace_id = ?1 AND deleted = 0 AND completed_at IS NULL AND project_id IS NULL`,
    )
    .bind(workspaceId)
    .all<{ pid: string | null; open: number; total: number }>();
  const projects: NonNullable<Counts['projects']> = {};
  let inbox = 0;
  for (const row of results) {
    if (row.pid === null) inbox = row.open;
    else projects[row.pid] = { open: row.open, total: row.total };
  }
  return { inbox, projects };
}

// ---------------------------------------------------------------- story 6: lifecycle and edit
// Every statement is scoped to the workspace. Only restoreTask (and the test-only raw read) touch rows
// with deleted = 1; nothing ever hard-deletes a task (prd.retain_deleted). sort_order is never written here,
// so a reopened or restored task comes back at its original position.

/** Why a guarded UPDATE touched no row: no such task here (missing), soft-deleted (gone) or already done (noop). */
async function classify(db: D1Database, workspaceId: string, taskId: string): Promise<MutationResult<Task>> {
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').bind(taskId, workspaceId).first<TaskRow>();
  if (!row) return { kind: 'missing' };
  if (row.deleted !== 0) return { kind: 'gone' };
  return { kind: 'noop', entity: rowToTask(row) };
}

/** Runs one guarded `UPDATE ... RETURNING *`; when it matched nothing, classifies the row with `onMiss`. */
async function guardedUpdate(
  db: D1Database,
  sql: string,
  params: unknown[],
  onMiss: () => Promise<MutationResult<Task>>,
): Promise<MutationResult<Task>> {
  const row = await db.prepare(sql).bind(...params).first<TaskRow>();
  return row ? { kind: 'changed', entity: rowToTask(row) } : onMiss();
}

/** Open -> Completed (completed_at = now). Completed: noop. Deleted: gone. */
export function completeTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    `UPDATE tasks SET completed_at = ?1, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 AND completed_at IS NULL RETURNING *`,
    [now, taskId, workspaceId],
    () => classify(db, workspaceId, taskId),
  );
}

/** Completed -> Open (completed_at = NULL). Open: noop. Deleted: gone. */
export function reopenTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    `UPDATE tasks SET completed_at = NULL, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 AND completed_at IS NOT NULL RETURNING *`,
    [now, taskId, workspaceId],
    () => classify(db, workspaceId, taskId),
  );
}

/** Soft delete: deleted = 1, deleted_at = now; every other column is kept. Already deleted: noop. */
export function softDeleteTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    `UPDATE tasks SET deleted = 1, deleted_at = ?1, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 RETURNING *`,
    [now, taskId, workspaceId],
    async () => {
      const row = await db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').bind(taskId, workspaceId).first<TaskRow>();
      return row ? { kind: 'noop', entity: rowToTask(row) } : { kind: 'missing' };
    },
  );
}

/**
 * Undo of a delete: deleted = 0, deleted_at = NULL; completed_at and sort_order are kept. Not deleted: noop.
 * The `deleted = 1` guard makes concurrent restores a single change.
 */
export function restoreTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    `UPDATE tasks SET deleted = 0, deleted_at = NULL, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 1 RETURNING *`,
    [now, taskId, workspaceId],
    () => classify(db, workspaceId, taskId),
  );
}

/**
 * Edits name and/or description. A blank name keeps the previous one (resolvePatchedName). Nothing
 * different: noop. Deleted (before or during): gone. Last write wins (no version precondition).
 */
export async function updateTask(
  db: D1Database,
  workspaceId: string,
  taskId: string,
  patch: TaskPatch,
  now: string,
): Promise<MutationResult<Task>> {
  const current = await db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').bind(taskId, workspaceId).first<TaskRow>();
  if (!current) return { kind: 'missing' };
  if (current.deleted !== 0) return { kind: 'gone' };
  const name = resolvePatchedName(patch.name, current.name);
  const description = patch.description ?? current.description;
  if (name === current.name && description === current.description) return { kind: 'noop', entity: rowToTask(current) };
  const row = await db
    .prepare(
      `UPDATE tasks SET name = ?1, description = ?2, version = version + 1, updated_at = ?3
       WHERE id = ?4 AND workspace_id = ?5 AND deleted = 0 RETURNING *`,
    )
    .bind(name, description, now, taskId, workspaceId)
    .first<TaskRow>();
  return row ? { kind: 'changed', entity: rowToTask(row) } : { kind: 'gone' };
}

/**
 * A list's non-deleted tasks: open ones by sort_order, then (includeCompleted) completed ones, most
 * recently completed first; ties by id. The Inbox is every task with no project (story 7); list=project is
 * one project's tasks.
 */
export async function listTasks(
  db: D1Database,
  workspaceId: string,
  filter: { list: TaskList; projectId?: string; includeCompleted: boolean },
): Promise<TaskRow[]> {
  const scope = filter.list === 'project' ? 'AND project_id = ?2' : 'AND project_id IS NULL';
  const statement = db.prepare(
    `SELECT * FROM tasks WHERE workspace_id = ?1 AND deleted = 0 ${scope} ${filter.includeCompleted ? '' : 'AND completed_at IS NULL'}
     ORDER BY (completed_at IS NOT NULL), sort_order * (completed_at IS NULL), completed_at DESC, id`,
  );
  const bound = filter.list === 'project' ? statement.bind(workspaceId, filter.projectId ?? '') : statement.bind(workspaceId);
  const { results } = await bound.all<TaskRow>();
  return results;
}

/** A task in this workspace whatever its state; null when it does not exist here. */
export function getTaskRow(db: D1Database, workspaceId: string, taskId: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').bind(taskId, workspaceId).first<TaskRow>();
}

/**
 * Story 7: moves a task to the Inbox (null) or a project, at the end of it: sort_order = the workspace's MAX +
 * TASK_SORT_STEP (story 5's workspace-wide rule), version + 1. Name, description, completion (and story 8's due
 * date) are never touched. The caller has already checked the destination and that the list differs.
 */
export async function moveTask(
  db: D1Database,
  workspaceId: string,
  taskId: string,
  projectId: string | null,
  now: string,
): Promise<MutationResult<Task>> {
  const row = await db
    .prepare(
      `UPDATE tasks SET project_id = ?1,
         sort_order = (SELECT COALESCE(MAX(sort_order), 0) + ?2 FROM tasks WHERE workspace_id = ?3),
         version = version + 1, updated_at = ?4
       WHERE id = ?5 AND workspace_id = ?3 AND deleted = 0 RETURNING *`,
    )
    .bind(projectId, TASK_SORT_STEP, workspaceId, now, taskId)
    .first<TaskRow>();
  if (row) return { kind: 'changed', entity: rowToTask(row) };
  return (await getTaskRow(db, workspaceId, taskId)) ? { kind: 'gone' } : { kind: 'missing' };
}

/** Test-only (GET /test/tasks/:id/raw): the stored row whatever its state, for retention checks. */
export function readRawTask(db: D1Database, taskId: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first<TaskRow>();
}
