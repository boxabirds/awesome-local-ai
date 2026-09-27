import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Counts, Task, TaskList, TaskPatch, TodayTask } from '@todoodle/shared/schemas';
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
  /** Story 8: the due date, a calendar date 'YYYY-MM-DD' (no time, no zone); NULL = no date. */
  due_date: string | null;
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
    dueDate: row.due_date ?? null,
  };
}

/** What a create writes. Story 7 adds projectId, story 8 dueDate (both optional: null). */
export type NewTaskRow = { id: string; workspaceId: string; name: string; description: string; projectId?: string | null; dueDate?: string | null };

/**
 * The one INSERT of a new task (quick add, and /test/seed through the same statement): after the workspace's
 * largest sort_order, nothing written when the id exists. The WHERE clause also resolves SQLite's
 * INSERT ... SELECT ... ON CONFLICT parse ambiguity.
 */
function insertStatement(db: D1Database, input: NewTaskRow): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO tasks (id, workspace_id, name, description, sort_order, project_id, due_date)
       SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(sort_order), 0) + ?5, ?6, ?7 FROM tasks WHERE workspace_id = ?2
       ON CONFLICT(id) DO NOTHING RETURNING *`,
    )
    .bind(input.id, input.workspaceId, input.name, input.description, TASK_SORT_STEP, input.projectId ?? null, input.dueDate ?? null);
}

/**
 * Test-only (/test/seed): inserts many tasks with the create statement, in batches (each one D1 transaction).
 * Existing ids are left as they are. Returns the inserted rows.
 */
export async function insertTasksForSeed(db: D1Database, inputs: NewTaskRow[], chunk = 500): Promise<TaskRow[]> {
  const rows: TaskRow[] = [];
  for (let start = 0; start < inputs.length; start += chunk) {
    const results = await db.batch<TaskRow>(inputs.slice(start, start + chunk).map((input) => insertStatement(db, input)));
    for (const result of results) if (result.results[0]) rows.push(result.results[0]);
  }
  return rows;
}

/** A Today row in the public shape: the task plus its project's name and colour (null for the Inbox). */
export function rowToTodayTask(row: TaskRow & { project_name: string | null; project_color: string | null }): TodayTask {
  return { ...rowToTask(row), projectName: row.project_name ?? null, projectColor: row.project_color ?? null };
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
 * (soft-deleted); another workspace -> conflict. A replay answers with the stored task whatever the retried body
 * says (story 8: its dueDate included), so a retried dated create never makes a second row.
 */
export async function insertTaskIdempotent(
  db: D1Database,
  input: NewTaskRow,
): Promise<InsertTaskResult> {
  const inserted = await insertStatement(db, input).first<TaskRow>();
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
 * completed, which is exactly the set a project delete removes. Story 8: with the viewer's `date`, also
 * today = open, non-deleted tasks due on or before it, not in a deleted project (SUM(CASE ...) in the same
 * statement); without a date the field is omitted (the server clock is never used).
 */
export async function countOpenTasks(db: D1Database, workspaceId: string, date?: string): Promise<Counts> {
  const { results } = await db
    .prepare(
      `SELECT p.id AS pid, COALESCE(SUM(t.id IS NOT NULL AND t.completed_at IS NULL), 0) AS open, COUNT(t.id) AS total, 0 AS today
       FROM projects p LEFT JOIN tasks t ON t.workspace_id = p.workspace_id AND t.project_id = p.id AND t.deleted = 0
       WHERE p.workspace_id = ?1 AND p.deleted = 0
       GROUP BY p.id
       UNION ALL
       SELECT NULL AS pid, COALESCE(SUM(t.project_id IS NULL), 0) AS open, COALESCE(SUM(t.project_id IS NULL), 0) AS total,
         COALESCE(SUM(CASE WHEN ?2 IS NOT NULL AND t.due_date <= ?2
           AND (t.project_id IS NULL OR EXISTS (SELECT 1 FROM projects dp WHERE dp.id = t.project_id AND dp.deleted = 0))
           THEN 1 ELSE 0 END), 0) AS today
       FROM tasks t WHERE t.workspace_id = ?1 AND t.deleted = 0 AND t.completed_at IS NULL`,
    )
    .bind(workspaceId, date ?? null)
    .all<{ pid: string | null; open: number; total: number; today: number }>();
  const projects: NonNullable<Counts['projects']> = {};
  let inbox = 0;
  let today = 0;
  for (const row of results) {
    if (row.pid === null) {
      inbox = row.open;
      today = row.today;
    } else projects[row.pid] = { open: row.open, total: row.total };
  }
  return date === undefined ? { inbox, projects } : { inbox, projects, today };
}

// ---------------------------------------------------------------- story 8: Today

/** A task row with its (active) project's name and colour; both null for the Inbox. */
export type TodayRow = TaskRow & { project_name: string | null; project_color: string | null };

/**
 * Today's rows for the viewer's `date`, in ONE statement: open non-deleted tasks due on or before it, and (with
 * includeCompleted) completed ones due on it; tasks in a deleted project are excluded. Ordered by due date,
 * then sort order. Dates compare as strings (zero-padded ISO). Uses idx_tasks_ws_due.
 */
export async function listDueOnOrBefore(db: D1Database, workspaceId: string, date: string, includeCompleted: boolean): Promise<TodayRow[]> {
  const { results } = await db.prepare(dueOnOrBeforeSql(includeCompleted)).bind(workspaceId, date).all<TodayRow>();
  return results;
}

/** listDueOnOrBefore's statement (?1 workspace id, ?2 date); exported so the query plan can be checked. */
export function dueOnOrBeforeSql(includeCompleted: boolean): string {
  const due = includeCompleted
    ? '((t.completed_at IS NULL AND t.due_date <= ?2) OR (t.completed_at IS NOT NULL AND t.due_date = ?2))'
    : 't.completed_at IS NULL AND t.due_date <= ?2';
  return `SELECT t.*, p.name AS project_name, p.color AS project_color
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id AND p.deleted = 0
       WHERE t.workspace_id = ?1 AND t.deleted = 0 AND ${due}
         AND (t.project_id IS NULL OR p.id IS NOT NULL)
       ORDER BY t.due_date, t.sort_order, t.id`;
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
 * Edits name, description and/or (story 8) the due date. A blank name keeps the previous one (resolvePatchedName). Nothing
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
  // Story 8: undefined keeps the due date, null clears it.
  const dueDate = patch.dueDate === undefined ? (current.due_date ?? null) : patch.dueDate;
  if (name === current.name && description === current.description && dueDate === (current.due_date ?? null)) {
    return { kind: 'noop', entity: rowToTask(current) };
  }
  const row = await db
    .prepare(
      `UPDATE tasks SET name = ?1, description = ?2, due_date = ?6, version = version + 1, updated_at = ?3
       WHERE id = ?4 AND workspace_id = ?5 AND deleted = 0 RETURNING *`,
    )
    .bind(name, description, now, taskId, workspaceId, dueDate)
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

// ---------------------------------------------------------------- story 8: reschedule overdue and its undo
// Ids travel as one JSON array bound to json_each (one parameter however many ids), so each operation is a
// single db.batch: one D1 transaction, all or nothing.

/** Eligible for reschedule: this workspace, not deleted, open, dated and due before `to`. */
const RESCHEDULE_ELIGIBLE = `workspace_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND deleted = 0
  AND completed_at IS NULL AND due_date IS NOT NULL AND due_date < ?3`;

export type RescheduleResult = { changed: Array<{ row: TaskRow; previousDueDate: string }>; skipped: string[] };

/**
 * Moves exactly the listed tasks that are still overdue for `to` to `to` (prd.reschedule_scope): completed,
 * deleted, no-longer-overdue and other workspaces' ids are skipped (without saying why). A SELECT of the previous
 * dates and the guarded UPDATE run in one batch, so both see the same rows.
 */
export async function rescheduleOverdue(db: D1Database, workspaceId: string, ids: string[], to: string, now: string): Promise<RescheduleResult> {
  const json = JSON.stringify(ids);
  const [before, updated] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT id, due_date FROM tasks WHERE ${RESCHEDULE_ELIGIBLE}`).bind(workspaceId, json, to),
    db
      .prepare(`UPDATE tasks SET due_date = ?3, version = version + 1, updated_at = ?4 WHERE ${RESCHEDULE_ELIGIBLE} RETURNING *`)
      .bind(workspaceId, json, to, now),
  ]);
  const previous = new Map(((before?.results ?? []) as Array<{ id: string; due_date: string }>).map((row) => [row.id, row.due_date]));
  const rows = (updated?.results ?? []) as TaskRow[];
  const changedIds = new Set(rows.map((row) => row.id));
  return {
    changed: rows.map((row) => ({ row, previousDueDate: previous.get(row.id)! })),
    skipped: ids.filter((id) => !changedIds.has(id)),
  };
}

export type RestoreDueDatesResult = { restored: Array<Pick<TaskRow, 'id' | 'due_date' | 'version'>>; skipped: Array<{ id: string; reason: 'changed' | 'gone' }> };

/**
 * Undo of a reschedule (prd.undo_reschedule): each task gets its previous date back only while it is still at
 * the version the reschedule left (nobody changed it since) and not deleted. The rest are reported: changed (it
 * is here, someone edited it) or gone (deleted, or not in this workspace). One UPDATE ... FROM json_each, then a
 * SELECT to classify, in one batch.
 */
export async function restoreDueDates(
  db: D1Database,
  workspaceId: string,
  items: Array<{ id: string; dueDate: string | null; expectedVersion: number }>,
  now: string,
): Promise<RestoreDueDatesResult> {
  const json = JSON.stringify(items);
  const [updated, after] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `UPDATE tasks SET due_date = json_extract(j.value, '$.dueDate'), version = tasks.version + 1, updated_at = ?3
         FROM json_each(?2) AS j
         WHERE tasks.id = json_extract(j.value, '$.id') AND tasks.workspace_id = ?1 AND tasks.deleted = 0
           AND tasks.version = json_extract(j.value, '$.expectedVersion')
         RETURNING id, due_date, version, deleted`,
      )
      .bind(workspaceId, json, now),
    db
      .prepare(`SELECT id, deleted FROM tasks WHERE workspace_id = ?1 AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`)
      .bind(workspaceId, json),
  ]);
  const restored = (updated?.results ?? []) as Array<Pick<TaskRow, 'id' | 'due_date' | 'version'>>;
  const restoredIds = new Set(restored.map((row) => row.id));
  const present = new Map(((after?.results ?? []) as Array<{ id: string; deleted: number }>).map((row) => [row.id, row.deleted === 0]));
  const skipped = items
    .filter((item) => !restoredIds.has(item.id))
    .map((item) => ({ id: item.id, reason: present.get(item.id) ? ('changed' as const) : ('gone' as const) }));
  return { restored, skipped };
}
