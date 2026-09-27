import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Task } from '@todoodle/shared/schemas';

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
export async function listOpenTasks(db: D1Database, workspaceId: string, _filter: TaskListFilter): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL
       ORDER BY sort_order, created_at, id`,
    )
    .bind(workspaceId)
    .all<TaskRow>();
  return results;
}

/** Open task counts per list. */
export async function countOpenTasks(db: D1Database, workspaceId: string): Promise<{ inbox: number }> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL')
    .bind(workspaceId)
    .first<{ n: number }>();
  return { inbox: row?.n ?? 0 };
}
