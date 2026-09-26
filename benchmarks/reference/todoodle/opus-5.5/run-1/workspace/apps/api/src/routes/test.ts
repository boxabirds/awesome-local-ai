import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { DEFAULT_WORKSPACE_NAME, MAX_REMEMBERED_WORKSPACES } from '@todoodle/shared/limits';
import { toPublicWorkspace } from '@todoodle/shared/schemas';
import { insertWorkspace } from '../db/workspaces.ts';
import { type RememberedEntry, serializeRememberedCookie } from '../lib/cookie.ts';
import { generateSecret, hashSecret } from '../lib/crypto.ts';
import { errorResponse } from '../lib/errors.ts';

/**
 * Tables emptied by POST /test/reset, children first so foreign keys are never violated.
 * Stories append their tables here (e.g. tasks and projects go before workspaces).
 */
export const TEST_RESET_TABLES: string[] = ['workspaces'];

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

/**
 * Seeds a workspace directly (no cookie), optionally soft-deleted, and returns its secret.
 * Body: { name?: string, deleted?: boolean }.
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
  return c.json({ workspace: toPublicWorkspace(row), secret }, 201);
});

/**
 * Creates `count` workspaces named 'Seeded 1' (most recent) to 'Seeded <count>' (oldest) and sets a
 * tdl_ws cookie remembering exactly them, one second apart. For e2e cap tests (TC-87).
 * Body: { count: 1..MAX_REMEMBERED_WORKSPACES }.
 */
testRoutes.post('/remembered-seed', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
  const count = body.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_REMEMBERED_WORKSPACES) {
    return errorResponse('validation', 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const entries: RememberedEntry[] = [];
  const workspaces = [];
  for (let i = 0; i < count; i++) {
    const secret = generateSecret();
    const row = await insertWorkspace(c.env.DB, await hashSecret(secret), `Seeded ${i + 1}`);
    entries.push({ id: row.id, s: secret, t: now - i - 1 });
    workspaces.push(toPublicWorkspace(row));
  }
  c.header('Set-Cookie', serializeRememberedCookie(entries, c.env));
  return c.json({ workspaces }, 201);
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
