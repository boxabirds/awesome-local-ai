import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { countOpenTasks } from '../db/tasks';

/** Open-task counts, mounted at /api/w/:workspaceId/counts behind workspace-auth (see app.ts). */
export const countRoutes = new Hono<AppEnv>();

countRoutes.get('/', async (c) => c.json(await countOpenTasks(c.env.DB, c.get('workspace').id)));
