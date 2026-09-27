import { CreateTaskInputSchema, EmptyBodySchema, ListTasksQuerySchema, type Task, TaskPatchSchema } from '@todoodle/shared/schemas';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import {
  completeTask,
  insertTaskIdempotent,
  listTasks,
  type MutationResult,
  reopenTask,
  restoreTask,
  rowToTask,
  softDeleteTask,
  updateTask,
} from '../db/tasks';
import { errorResponse } from '../lib/errors';
import { broadcast } from '../live/broadcast';

/** Task API, mounted at /api/w/:workspaceId/tasks behind workspace-auth (see app.ts). */
export const taskRoutes = new Hono<AppEnv>();

/**
 * One list, in list order: open tasks, then (include_completed=true) completed ones, most
 * recently completed first. Cache-Control: no-store comes from finalizeResponse.
 */
taskRoutes.get('/', async (c) => {
  const parsed = ListTasksQuerySchema.safeParse({ list: c.req.query('list'), include_completed: c.req.query('include_completed') });
  if (!parsed.success) return errorResponse('validation', 400);
  const rows = await listTasks(c.env.DB, c.get('workspace').id, {
    list: parsed.data.list,
    includeCompleted: parsed.data.include_completed === 'true',
  });
  return c.json({ tasks: rows.map(rowToTask) });
});

/**
 * Idempotent create: the client picks the id, so a retry after a lost response returns the task
 * that already exists (200, stored values win) instead of creating a second one.
 */
taskRoutes.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('validation', 400);
  }
  const parsed = CreateTaskInputSchema.safeParse(body);
  if (!parsed.success) return errorResponse('validation', 400);

  const workspaceId = c.get('workspace').id;
  const result = await insertTaskIdempotent(c.env.DB, { ...parsed.data, workspaceId });
  switch (result.status) {
    case 'created': {
      const task = rowToTask(result.task);
      broadcast(c, workspaceId, { type: 'task.upserted', entity: task, version: task.version });
      return c.json({ task }, 201);
    }
    case 'replayed':
      // Nothing changed, so nothing is broadcast.
      return c.json({ task: rowToTask(result.task) }, 200);
    case 'gone':
      return errorResponse('gone', 410);
    case 'conflict':
      return errorResponse('id_conflict', 409);
  }
});

/* Lifecycle (story 6). Deleting never asks for confirmation in any client; Undo calls reopen or
 * restore, which the server accepts at any time (the 10 s window is the UI's). */

type Lifecycle = (db: D1Database, workspaceId: string, taskId: string, now: string) => Promise<MutationResult<Task>>;
type LifecycleEvent = 'task.upserted' | 'task.restored' | 'task.deleted';

/** Lifecycle POSTs take no body, or an empty JSON object (the media type is checked by validate). */
async function hasValidEmptyBody(c: Context<AppEnv>): Promise<boolean> {
  const text = await c.req.text();
  if (text.trim() === '') return true;
  try {
    return EmptyBodySchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}

/** Maps a mutation result to its response; a real change is broadcast once (noops never are). */
function respond(c: Context<AppEnv>, result: MutationResult<Task>, eventType: LifecycleEvent, okStatus: 200 | 204 = 200): Response {
  switch (result.kind) {
    case 'missing':
      return errorResponse('not_found', 404);
    case 'gone':
      return errorResponse('gone', 410);
    case 'changed': {
      const task = result.entity;
      const workspaceId = c.get('workspace').id;
      if (eventType === 'task.deleted') {
        broadcast(c, workspaceId, { type: 'task.deleted', entity: { id: task.id }, version: task.version });
      } else {
        broadcast(c, workspaceId, { type: eventType, entity: task, version: task.version });
      }
      break;
    }
    case 'noop':
      break;
  }
  return okStatus === 204 ? c.body(null, 204) : c.json({ task: result.entity });
}

/** A POST /:taskId/<action> route: optional empty body, then the guarded mutation. */
function lifecycleRoute(fn: Lifecycle, eventType: LifecycleEvent) {
  return async (c: Context<AppEnv>) => {
    if (!(await hasValidEmptyBody(c))) return errorResponse('validation', 400);
    const result = await fn(c.env.DB, c.get('workspace').id, c.req.param('taskId')!, new Date().toISOString());
    return respond(c, result, eventType);
  };
}

taskRoutes.post('/:taskId/complete', lifecycleRoute(completeTask, 'task.upserted'));
taskRoutes.post('/:taskId/reopen', lifecycleRoute(reopenTask, 'task.upserted'));
taskRoutes.post('/:taskId/restore', lifecycleRoute(restoreTask, 'task.restored'));

/** Soft delete (retained for operator recovery). 204 whether it was deleted now or already. */
taskRoutes.delete('/:taskId', async (c) => {
  const result = await softDeleteTask(c.env.DB, c.get('workspace').id, c.req.param('taskId'), new Date().toISOString());
  return respond(c, result, 'task.deleted', 204);
});

/** Edit name and/or description. A blank name keeps the previous name. Last write wins. */
taskRoutes.patch('/:taskId', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('validation', 400);
  }
  const parsed = TaskPatchSchema.safeParse(body);
  if (!parsed.success) return errorResponse('validation', 400);
  const result = await updateTask(c.env.DB, c.get('workspace').id, c.req.param('taskId'), parsed.data, new Date().toISOString());
  return respond(c, result, 'task.upserted');
});
