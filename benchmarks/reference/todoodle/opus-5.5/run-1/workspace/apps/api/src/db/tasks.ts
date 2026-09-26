import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Task, TaskList } from '@todoodle/shared/schemas';

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

/** Open (not completed), non-deleted tasks of a list, oldest first. Story 5 only has the Inbox. */
export async function listOpenTasks(db: D1Database, workspaceId: string, _query: { list: TaskList }): Promise<TaskRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL
       ORDER BY sort_order, created_at, id`,
    )
    .bind(workspaceId)
    .all<TaskRow>();
  return results;
}

/** Open, non-deleted task counts per list. Stories 7 and 8 add fields. */
export async function countOpenTasks(db: D1Database, workspaceId: string): Promise<{ inbox: number }> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND deleted = 0 AND completed_at IS NULL')
    .bind(workspaceId)
    .first<{ n: number }>();
  return { inbox: row?.n ?? 0 };
}
