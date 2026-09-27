import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { errorResponse } from '../lib/errors';

/**
 * Tables emptied by POST /test/reset, children first (FK-safe order). Empty in story 1;
 * later stories append their tables (workspaces, tasks, projects, ...).
 */
export const TEST_RESET_TABLES: string[] = [];

/** Test-only routes. In production they do not exist: same 404 as any unknown API route. */
export const testRoutes = new Hono<AppEnv>();

testRoutes.use('*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'production') return errorResponse('not_found', 404);
  await next();
});

testRoutes.post('/reset', async (c) => {
  if (TEST_RESET_TABLES.length > 0) {
    await c.env.DB.batch(
      TEST_RESET_TABLES.map((table) => c.env.DB.prepare(`DELETE FROM "${table.replaceAll('"', '""')}"`)),
    );
  }
  return c.json({ ok: true });
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
