import { CreateTaskInputSchema, TaskListQuerySchema } from '@todoodle/shared/schemas';
import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { insertTaskIdempotent, listOpenTasks, rowToTask } from '../db/tasks.ts';
import { errorResponse } from '../lib/errors.ts';
import { readJson } from '../lib/json.ts';
import { broadcast } from '../live/broadcast.ts';

/** Routes under /api/w/:workspaceId/tasks, mounted behind workspace-auth (c.var.workspace is verified). */
export const tasksRoutes = new Hono<AppEnv>();

/** GET ?list=inbox (the default): the list's open tasks in order. Any other list is 400 until stories 7/8 add it. */
tasksRoutes.get('/', async (c) => {
  const parsed = TaskListQuerySchema.safeParse({ list: c.req.query('list') });
  if (!parsed.success) return errorResponse('validation', 400);
  const rows = await listOpenTasks(c.env.DB, c.var.workspace.id, parsed.data);
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
