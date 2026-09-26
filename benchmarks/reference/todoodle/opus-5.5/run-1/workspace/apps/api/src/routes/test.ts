import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { errorResponse } from '../lib/errors.ts';

/**
 * Tables emptied by POST /test/reset, children first so foreign keys are never violated.
 * Empty in story 1; later stories append their tables (e.g. tasks, projects, workspaces).
 */
export const TEST_RESET_TABLES: string[] = [];

/** Test-only routes. In production they do not exist: every /test/* path is the plain API 404. */
export const testRoutes = new Hono<AppEnv>();

testRoutes.use('*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'production') return errorResponse('not_found', 404);
  await next();
});

testRoutes.post('/reset', async (c) => {
  if (TEST_RESET_TABLES.length > 0) {
    await c.env.DB.batch(TEST_RESET_TABLES.map((table) => c.env.DB.prepare(`DELETE FROM "${table}"`)));
  }
  return c.json({ ok: true });
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
