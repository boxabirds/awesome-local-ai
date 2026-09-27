import { TASKS_BULK_MAX_IDS } from '@todoodle/shared/limits';
import {
  CreateTaskInputSchema,
  EmptyBodySchema,
  ListTasksQuerySchema,
  type RescheduleResponse,
  type RestoreDueDatesResponse,
  type Task,
  TaskIdSchema,
  TaskPatchSchema,
  rescheduleRequestSchema,
  restoreDueDatesRequestSchema,
} from '@todoodle/shared/schemas';
import type { MutationResult } from '@todoodle/shared/types';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { getActiveProjectForWorkspace } from '../db/projects.ts';
import {
  classifyCreateWithoutProject,
  completeTask,
  getTaskRow,
  insertTaskIdempotent,
  listTasks,
  moveTask,
  reopenTask,
  rescheduleOverdue,
  restoreDueDates,
  restoreTask,
  rowToTask,
  softDeleteTask,
  updateTask,
} from '../db/tasks.ts';
import { errorResponse } from '../lib/errors.ts';
import { readJson } from '../lib/json.ts';
import { classifyMove } from '../lib/moveRules.ts';
import { broadcast } from '../live/broadcast.ts';

/** Routes under /api/w/:workspaceId/tasks, mounted behind workspace-auth (c.var.workspace is verified). */
export const tasksRoutes = new Hono<AppEnv>();

/**
 * GET ?list=inbox (the default)|project&projectId=&include_completed=true|false (default false): the list's
 * open tasks in order, then (include_completed) its completed tasks, most recent first. Soft-deleted tasks
 * never appear. list=project: 410 for a deleted project, 404 project_not_found for one that is not here.
 */
tasksRoutes.get('/', async (c) => {
  const parsed = ListTasksQuerySchema.safeParse({
    list: c.req.query('list'),
    projectId: c.req.query('projectId'),
    include_completed: c.req.query('include_completed'),
  });
  if (!parsed.success) return errorResponse('validation', 400);
  const { list, projectId } = parsed.data;
  if (list === 'project') {
    const state = await getActiveProjectForWorkspace(c.env.DB, c.var.workspace.id, projectId!);
    if (state === 'deleted') return errorResponse('gone', 410);
    if (state === 'missing') return errorResponse('project_not_found', 404);
  }
  const rows = await listTasks(c.env.DB, c.var.workspace.id, {
    list,
    ...(list === 'project' ? { projectId } : {}),
    includeCompleted: parsed.data.include_completed === 'true',
  });
  return c.json({ tasks: rows.map(rowToTask) });
});

/**
 * Idempotent create: the client generates the id, so a retry after a lost response returns the stored
 * task (200) instead of inserting a duplicate. Only a real insert (201) broadcasts.
 */
tasksRoutes.post('/', async (c) => {
  const parsed = CreateTaskInputSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const workspaceId = c.var.workspace.id;
  const { projectId } = parsed.data;
  // Story 7: the project is checked only for a row that would be inserted; a replay answers as before.
  const projectActive = !projectId || (await getActiveProjectForWorkspace(c.env.DB, workspaceId, projectId)) === 'active';
  const result = projectActive
    ? await insertTaskIdempotent(c.env.DB, { ...parsed.data, workspaceId })
    : await classifyCreateWithoutProject(c.env.DB, parsed.data.id, workspaceId);
  switch (result.status) {
    case 'project_not_found':
      return errorResponse('project_not_found', 404);
    case 'created': {
      const task = rowToTask(result.task);
      // After the write commits: everyone else with the workspace open sees the new task.
      broadcast(c, workspaceId, { type: 'task.upserted', entity: task, version: task.version });
      return c.json({ task }, 201);
    }
    case 'replayed':
      return c.json({ task: rowToTask(result.task) }, 200);
    case 'gone':
      return errorResponse('gone', 410);
    case 'conflict':
      return errorResponse('id_conflict', 409);
  }
});

// ---------------------------------------------------------------- story 8: reschedule overdue and undo
// Literal paths, registered before the /:taskId routes (due-dates/restore would otherwise match /:taskId/restore).

/** One tasks.bulk for the changed ids (split so no event exceeds the live size limit). None when nothing changed. */
function broadcastBulk(c: Context<AppEnv>, rows: Array<{ id: string; version: number }>): void {
  if (rows.length === 0) return;
  const version = Math.max(...rows.map((row) => row.version));
  for (let start = 0; start < rows.length; start += TASKS_BULK_MAX_IDS) {
    const ids = rows.slice(start, start + TASKS_BULK_MAX_IDS).map((row) => row.id);
    broadcast(c, c.var.workspace.id, { type: 'tasks.bulk', entity: { ids }, version });
  }
}

/**
 * Reschedule overdue (today.reschedule): { ids, to } -> only ids still overdue for `to` move to `to`; the rest
 * are skipped. One atomic batch (500 with nothing written if it fails).
 */
tasksRoutes.post('/reschedule', async (c) => {
  const parsed = rescheduleRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const result = await rescheduleOverdue(c.env.DB, c.var.workspace.id, parsed.data.ids, parsed.data.to, new Date().toISOString());
  const body: RescheduleResponse = {
    changed: result.changed.map(({ row, previousDueDate }) => ({ id: row.id, previousDueDate, dueDate: row.due_date!, version: row.version })),
    skipped: result.skipped,
  };
  broadcastBulk(c, result.changed.map(({ row }) => row));
  return c.json(body);
});

/** Undo of a reschedule: { items: [{id, dueDate, expectedVersion}] } -> restored, or skipped as changed/gone. */
tasksRoutes.post('/due-dates/restore', async (c) => {
  const parsed = restoreDueDatesRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const result = await restoreDueDates(c.env.DB, c.var.workspace.id, parsed.data.items, new Date().toISOString());
  const body: RestoreDueDatesResponse = {
    restored: result.restored.map((row) => ({ id: row.id, dueDate: row.due_date ?? null, version: row.version })),
    skipped: result.skipped,
  };
  broadcastBulk(c, result.restored);
  return c.json(body);
});

// ---------------------------------------------------------------- story 6: lifecycle and edit

type AppContext = Context<AppEnv>;
type Mutation = (db: D1Database, workspaceId: string, taskId: string, now: string) => Promise<MutationResult<Task>>;

/** The row's id from the path; a malformed id can't name a task, so it is a plain 404. */
function taskIdOf(c: AppContext): string | null {
  const parsed = TaskIdSchema.safeParse(c.req.param('taskId'));
  return parsed.success ? parsed.data : null;
}

/** Maps a mutation result to a response; only a real change broadcasts (after the write committed). */
function respond(c: AppContext, result: MutationResult<Task>, event: 'task.upserted' | 'task.restored' | 'task.deleted'): Response {
  switch (result.kind) {
    case 'missing':
      return errorResponse('not_found', 404);
    case 'gone':
      return errorResponse('gone', 410);
    case 'noop':
      return event === 'task.deleted' ? c.body(null, 204) : c.json({ task: result.entity });
    case 'changed': {
      const task = result.entity;
      const workspaceId = c.var.workspace.id;
      if (event === 'task.deleted') {
        broadcast(c, workspaceId, { type: 'task.deleted', entity: { id: task.id }, version: task.version });
        return c.body(null, 204);
      }
      broadcast(c, workspaceId, { type: event, entity: task, version: task.version });
      return c.json({ task });
    }
  }
}

/**
 * complete / reopen / restore: bodyless (or JSON `{}`), idempotent. Already in the target state -> 200
 * with the unchanged task, no version bump, no broadcast.
 */
function lifecycleRoute(fn: Mutation, event: 'task.upserted' | 'task.restored') {
  return async (c: AppContext) => {
    const body = await readJson(c.req.raw);
    if (body !== undefined && !EmptyBodySchema.safeParse(body).success) return errorResponse('validation', 400);
    const taskId = taskIdOf(c);
    if (!taskId) return errorResponse('not_found', 404);
    return respond(c, await fn(c.env.DB, c.var.workspace.id, taskId, new Date().toISOString()), event);
  };
}

tasksRoutes.post('/:taskId/complete', lifecycleRoute(completeTask, 'task.upserted'));
tasksRoutes.post('/:taskId/reopen', lifecycleRoute(reopenTask, 'task.upserted'));
tasksRoutes.post('/:taskId/restore', lifecycleRoute(restoreTask, 'task.restored'));

/** Soft delete (204). No confirmation exists in any client: Undo (restore) is the safeguard. */
tasksRoutes.delete('/:taskId', async (c) => {
  const taskId = taskIdOf(c);
  if (!taskId) return errorResponse('not_found', 404);
  return respond(c, await softDeleteTask(c.env.DB, c.var.workspace.id, taskId, new Date().toISOString()), 'task.deleted');
});

/**
 * Edit name, description and/or (story 8) dueDate (strict body; dueDate null clears it). A blank name keeps the previous one. Story 7: projectId moves
 * the task (null = Inbox) to the end of that list: 404 project_not_found unless the destination is an active
 * project here; moving to the list it is already in writes nothing and broadcasts nothing.
 */
tasksRoutes.patch('/:taskId', async (c) => {
  const parsed = TaskPatchSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const taskId = taskIdOf(c);
  if (!taskId) return errorResponse('not_found', 404);
  const workspaceId = c.var.workspace.id;
  const now = new Date().toISOString();
  const { projectId, ...edit } = parsed.data;
  if (projectId === undefined) return respond(c, await updateTask(c.env.DB, workspaceId, taskId, edit, now), 'task.upserted');

  const current = await getTaskRow(c.env.DB, workspaceId, taskId);
  if (!current) return errorResponse('not_found', 404);
  if (current.deleted !== 0) return errorResponse('gone', 410);
  const destState = projectId === null ? null : await getActiveProjectForWorkspace(c.env.DB, workspaceId, projectId);
  const decision = classifyMove(current.project_id ?? null, projectId, destState);
  if (decision === 'project_not_found') return errorResponse('project_not_found', 404);

  let result: MutationResult<Task> = { kind: 'noop', entity: rowToTask(current) };
  if (edit.name !== undefined || edit.description !== undefined || edit.dueDate !== undefined) {
    result = await updateTask(c.env.DB, workspaceId, taskId, edit, now);
    if (result.kind === 'missing' || result.kind === 'gone') return respond(c, result, 'task.upserted');
  }
  if (decision === 'move') result = await moveTask(c.env.DB, workspaceId, taskId, projectId, now);
  return respond(c, result, 'task.upserted');
});
