import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { countOpenTasks } from '../db/tasks.ts';

/** GET /api/w/:workspaceId/counts (behind workspace-auth): open-task counts per list. One statement. */
export async function countsHandler(c: Context<AppEnv>): Promise<Response> {
  return c.json(await countOpenTasks(c.env.DB, c.var.workspace.id));
}
