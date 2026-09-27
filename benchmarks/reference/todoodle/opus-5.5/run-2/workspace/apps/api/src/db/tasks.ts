import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import { resolvePatchedName, type Task, type TaskPatch } from '@todoodle/shared/schemas';
import type { MutationResult } from '@todoodle/shared/types';

export type { MutationResult };

/** A stored task row. */
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

export type InsertTaskResult =
  | { status: 'created' | 'replayed'; task: TaskRow }
  | { status: 'gone' | 'conflict'; task?: undefined };

/** The lists a task list can be asked for. Stories 7 and 8 add project and today. */
export type TaskListFilter = { list: 'inbox' };

/** A list query: the list, and whether completed tasks are included (story 6). */
export type TaskListOptions = TaskListFilter & { includeCompleted?: boolean };

/** Maps a stored row to the public shape (snake_case to camelCase). */
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

/**
 * Creates the task at the end of the workspace, or finds the existing one with that id. One
 * statement, so the MAX + step ordering is atomic under D1's serialised writes. MAX spans all of
 * the workspace's tasks (completed and deleted too), so a reopened task keeps a unique position.
 * The WHERE clause is required before ON CONFLICT in INSERT ... SELECT (SQLite parse ambiguity).
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
  if (!existing) throw new Error('insertTaskIdempotent: no row inserted and none found');
  if (existing.workspace_id !== input.workspaceId) return { status: 'conflict' };
  if (existing.deleted !== 0) return { status: 'gone' };
  return { status: 'replayed', task: existing };
}

/** Open (not completed, not deleted) tasks of one list, in list order. */
export function listOpenTasks(db: D1Database, workspaceId: string, filter: TaskListFilter): Promise<TaskRow[]> {
  return listTasks(db, workspaceId, { ...filter, includeCompleted: false });
}

/**
 * Tasks of one list, never deleted ones: open tasks by sort_order, then (with includeCompleted)
 * completed tasks by completed_at, most recent first; ties by id. The filter is an object so
 * story 7's project scope composes.
 */
export async function listTasks(db: D1Database, workspaceId: string, opts: TaskListOptions): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      opts.includeCompleted
        ? `SELECT * FROM tasks WHERE workspace_id = ? AND deleted = 0
           ORDER BY (completed_at IS NOT NULL), CASE WHEN completed_at IS NULL THEN sort_order END,
                    completed_at DESC, id`
        : `SELECT * FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL
           ORDER BY sort_order, id`,
    )
    .bind(workspaceId)
    .all<TaskRow>();
  return results;
}

/* Lifecycle (story 6). Every mutation is one guarded UPDATE ... RETURNING; when it matches no
 * row, a SELECT classifies why (missing, gone or already in the wanted state). sort_order is never
 * touched, so a reopened or restored task comes back at its original position. Nothing here (or
 * anywhere) hard-deletes a task. */

/** The row of this workspace with this id, deleted or not. */
async function findTask(db: D1Database, workspaceId: string, taskId: string): Promise<TaskRow | null> {
  return db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').bind(taskId, workspaceId).first<TaskRow>();
}

/** Why a guarded update matched nothing: missing, gone (soft-deleted) or already done (noop). */
async function classify(db: D1Database, workspaceId: string, taskId: string, deletedIsNoop = false): Promise<MutationResult<Task>> {
  const row = await findTask(db, workspaceId, taskId);
  if (!row) return { kind: 'missing' };
  if (row.deleted !== 0 && !deletedIsNoop) return { kind: 'gone' };
  return { kind: 'noop', entity: rowToTask(row) };
}

async function guardedUpdate(
  db: D1Database,
  workspaceId: string,
  taskId: string,
  sql: string,
  params: unknown[],
  deletedIsNoop = false,
): Promise<MutationResult<Task>> {
  const row = await db.prepare(sql).bind(...params).first<TaskRow>();
  if (row) return { kind: 'changed', entity: rowToTask(row) };
  return classify(db, workspaceId, taskId, deletedIsNoop);
}

/** Open -> Completed (completed_at = now). Completed is a noop; deleted is gone. */
export function completeTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    workspaceId,
    taskId,
    `UPDATE tasks SET completed_at = ?1, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 AND completed_at IS NULL RETURNING *`,
    [now, taskId, workspaceId],
  );
}

/** Completed -> Open (completed_at = NULL). Open is a noop; deleted is gone. */
export function reopenTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    workspaceId,
    taskId,
    `UPDATE tasks SET completed_at = NULL, version = version + 1, updated_at = ?1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 AND completed_at IS NOT NULL RETURNING *`,
    [now, taskId, workspaceId],
  );
}

/** Soft delete: deleted = 1, deleted_at = now, version + 1; every other column is kept. Already deleted is a noop. */
export function softDeleteTask(db: D1Database, workspaceId: string, taskId: string, now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    workspaceId,
    taskId,
    `UPDATE tasks SET deleted = 1, deleted_at = ?1, version = version + 1
     WHERE id = ?2 AND workspace_id = ?3 AND deleted = 0 RETURNING *`,
    [now, taskId, workspaceId],
    true,
  );
}

/**
 * Undoes a soft delete; completed_at and sort_order are kept. Not deleted is a noop. The guard
 * (deleted = 1) makes concurrent restores a single change.
 */
export function restoreTask(db: D1Database, workspaceId: string, taskId: string, _now: string): Promise<MutationResult<Task>> {
  return guardedUpdate(
    db,
    workspaceId,
    taskId,
    `UPDATE tasks SET deleted = 0, deleted_at = NULL, version = version + 1
     WHERE id = ?1 AND workspace_id = ?2 AND deleted = 1 RETURNING *`,
    [taskId, workspaceId],
    true,
  );
}

/**
 * Edits name and/or description of an open or completed task. A blank name keeps the previous one;
 * an empty description clears it. No effective change is a noop (no version bump). Last write wins.
 */
export async function updateTask(
  db: D1Database,
  workspaceId: string,
  taskId: string,
  patch: TaskPatch,
  now: string,
): Promise<MutationResult<Task>> {
  const current = await findTask(db, workspaceId, taskId);
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
  // Deleted between the read and the write.
  return row ? { kind: 'changed', entity: rowToTask(row) } : { kind: 'gone' };
}

/** Open task counts per list. */
export async function countOpenTasks(db: D1Database, workspaceId: string): Promise<{ inbox: number }> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL')
    .bind(workspaceId)
    .first<{ n: number }>();
  return { inbox: row?.n ?? 0 };
}
