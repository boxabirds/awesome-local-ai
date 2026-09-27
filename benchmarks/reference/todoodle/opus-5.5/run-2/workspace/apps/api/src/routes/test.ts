import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { DEFAULT_WORKSPACE_NAME } from '@todoodle/shared/limits';
import { toPublicWorkspace } from '@todoodle/shared/schemas';
import { insertWorkspace } from '../db/workspaces';
import { generateSecret, hashSecret } from '../lib/crypto';
import { errorResponse } from '../lib/errors';

/**
 * Tables emptied by POST /test/reset, children first (FK-safe order). Story 2 adds workspaces;
 * later stories append their tables (workspaces, tasks, projects, ...).
 */
export const TEST_RESET_TABLES: string[] = ['workspaces'];

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

/**
 * Seeds a workspace directly, optionally soft-deleted (no user-facing delete exists yet).
 * Body: { name?: string, deleted?: boolean }. Returns { workspace, secret }.
 */
testRoutes.post('/seed-workspace', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; deleted?: unknown };
  const secret = generateSecret();
  const name = typeof body.name === 'string' ? body.name : DEFAULT_WORKSPACE_NAME;
  let row = await insertWorkspace(c.env.DB, await hashSecret(secret), name);
  if (body.deleted === true) {
    const deleted = await c.env.DB.prepare(
      "UPDATE workspaces SET deleted = 1, deleted_at = datetime('now') WHERE id = ? RETURNING *",
    )
      .bind(row.id)
      .first<typeof row>();
    if (deleted) row = deleted;
  }
  return c.json({ workspace: toPublicWorkspace(row), secret, deleted: row.deleted === 1 }, 201);
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
