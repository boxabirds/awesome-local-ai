import { CreateTaskInputSchema, TaskListQuerySchema } from '@todoodle/shared/schemas';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { insertTaskIdempotent, listOpenTasks, rowToTask } from '../db/tasks';
import { errorResponse } from '../lib/errors';
import { broadcast } from '../live/broadcast';

/** Task API, mounted at /api/w/:workspaceId/tasks behind workspace-auth (see app.ts). */
export const taskRoutes = new Hono<AppEnv>();

/** Open tasks of one list, in list order. Cache-Control: no-store comes from finalizeResponse. */
taskRoutes.get('/', async (c) => {
  const parsed = TaskListQuerySchema.safeParse({ list: c.req.query('list') });
  if (!parsed.success) return errorResponse('validation', 400);
  const rows = await listOpenTasks(c.env.DB, c.get('workspace').id, parsed.data);
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
