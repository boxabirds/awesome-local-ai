import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Task, TaskList, TaskPatch } from '@todoodle/shared/schemas';
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
};

/** Maps a stored row to the public Task shape. Only whitelisted fields are copied. */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
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
  input: { id: string; workspaceId: string; name: string; description: string },
): Promise<InsertTaskResult> {
  const inserted = await db
    .prepare(
      `INSERT INTO tasks (id, workspace_id, name, description, sort_order)
       SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(sort_order), 0) + ?5 FROM tasks WHERE workspace_id = ?2
       ON CONFLICT(id) DO NOTHING RETURNING *`,
    )
    .bind(input.id, input.workspaceId, input.name, input.description, TASK_SORT_STEP)
    .first<TaskRow>();
  if (inserted) return { status: 'created', task: inserted };

  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(input.id).first<TaskRow>();
  // The row vanished between the two statements: nothing to replay, so report it as gone.
  if (!existing) return { status: 'gone' };
  if (existing.workspace_id !== input.workspaceId) return { status: 'conflict' };
  if (existing.deleted !== 0) return { status: 'gone' };
  return { status: 'replayed', task: existing };
}

/** Open (not completed), non-deleted tasks of a list, in order. Story 5 only has the Inbox. */
export function listOpenTasks(db: D1Database, workspaceId: string, query: { list: TaskList }): Promise<TaskRow[]> {
  return listTasks(db, workspaceId, { list: query.list, includeCompleted: false });
}

/** Open, non-deleted task counts per list. Stories 7 and 8 add fields. */
export async function countOpenTasks(db: D1Database, workspaceId: string): Promise<{ inbox: number }> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL')
    .bind(workspaceId)
    .first<{ n: number }>();
  return { inbox: row?.n ?? 0 };
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
 * recently completed first; ties by id. The filter object lets story 7's project scope compose.
 */
export async function listTasks(
  db: D1Database,
  workspaceId: string,
  filter: { list: TaskList; includeCompleted: boolean },
): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM tasks WHERE workspace_id = ? AND deleted = 0 ${filter.includeCompleted ? '' : 'AND completed_at IS NULL'}
       ORDER BY (completed_at IS NOT NULL), sort_order * (completed_at IS NULL), completed_at DESC, id`,
    )
    .bind(workspaceId)
    .all<TaskRow>();
  return results;
}

/** Test-only (GET /test/tasks/:id/raw): the stored row whatever its state, for retention checks. */
export function readRawTask(db: D1Database, taskId: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first<TaskRow>();
}
