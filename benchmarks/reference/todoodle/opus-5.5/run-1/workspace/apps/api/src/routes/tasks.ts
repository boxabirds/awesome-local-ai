import { CreateTaskInputSchema, EmptyBodySchema, ListTasksQuerySchema, type Task, TaskIdSchema, TaskPatchSchema } from '@todoodle/shared/schemas';
import type { MutationResult } from '@todoodle/shared/types';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import {
  completeTask,
  insertTaskIdempotent,
  listTasks,
  reopenTask,
  restoreTask,
  rowToTask,
  softDeleteTask,
  updateTask,
} from '../db/tasks.ts';
import { errorResponse } from '../lib/errors.ts';
import { readJson } from '../lib/json.ts';
import { broadcast } from '../live/broadcast.ts';

/** Routes under /api/w/:workspaceId/tasks, mounted behind workspace-auth (c.var.workspace is verified). */
export const tasksRoutes = new Hono<AppEnv>();

/**
 * GET ?list=inbox (the default)&include_completed=true|false (default false): the list's open tasks in
 * order, then (include_completed) its completed tasks, most recent first. Soft-deleted tasks never appear.
 */
tasksRoutes.get('/', async (c) => {
  const parsed = ListTasksQuerySchema.safeParse({ list: c.req.query('list'), include_completed: c.req.query('include_completed') });
  if (!parsed.success) return errorResponse('validation', 400);
  const rows = await listTasks(c.env.DB, c.var.workspace.id, {
    list: parsed.data.list,
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
  const result = await insertTaskIdempotent(c.env.DB, { ...parsed.data, workspaceId });
  switch (result.status) {
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

/** Edit name and/or description (strict body). A blank name keeps the previous one. */
tasksRoutes.patch('/:taskId', async (c) => {
  const parsed = TaskPatchSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const taskId = taskIdOf(c);
  if (!taskId) return errorResponse('not_found', 404);
  return respond(c, await updateTask(c.env.DB, c.var.workspace.id, taskId, parsed.data, new Date().toISOString()), 'task.upserted');
});
