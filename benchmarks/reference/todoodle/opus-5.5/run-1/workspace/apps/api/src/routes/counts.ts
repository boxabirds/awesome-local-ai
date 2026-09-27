import { countsQuerySchema } from '@todoodle/shared/schemas';
import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { countOpenTasks } from '../db/tasks.ts';
import { errorResponse } from '../lib/errors.ts';

/**
 * GET /api/w/:workspaceId/counts[?date=YYYY-MM-DD] (behind workspace-auth): open-task counts per list, in one
 * statement. Story 8: the viewer's date adds `today` (Today + Overdue); an invalid date is 400.
 */
export async function countsHandler(c: Context<AppEnv>): Promise<Response> {
  const parsed = countsQuerySchema.safeParse({ date: c.req.query('date') });
  if (!parsed.success) return errorResponse('validation', 400);
  return c.json(await countOpenTasks(c.env.DB, c.var.workspace.id, parsed.data.date));
}
