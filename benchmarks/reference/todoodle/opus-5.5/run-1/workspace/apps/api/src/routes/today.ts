import { todayQuerySchema } from '@todoodle/shared/schemas';
import type { Context } from 'hono';
import type { AppEnv } from '../app.ts';
import { listDueOnOrBefore, rowToTodayTask } from '../db/tasks.ts';
import { errorResponse } from '../lib/errors.ts';
import { todayResponse } from '../today/split.ts';

/**
 * GET /api/w/:workspaceId/today?date=YYYY-MM-DD[&includeCompleted=1] (behind workspace-auth): the viewer's
 * Overdue and Today tasks across the Inbox and every active project. `date` is the viewer's local date and is
 * required: the server never substitutes its own clock (400 validation when missing or invalid).
 */
export async function todayHandler(c: Context<AppEnv>): Promise<Response> {
  const parsed = todayQuerySchema.safeParse({ date: c.req.query('date'), includeCompleted: c.req.query('includeCompleted') });
  if (!parsed.success) return errorResponse('validation', 400);
  const { date, includeCompleted } = parsed.data;
  const rows = await listDueOnOrBefore(c.env.DB, c.var.workspace.id, date, includeCompleted);
  return c.json(todayResponse(rows.map(rowToTodayTask), date));
}
