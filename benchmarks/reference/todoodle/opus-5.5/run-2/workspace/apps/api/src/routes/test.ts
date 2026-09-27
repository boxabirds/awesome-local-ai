import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { DEFAULT_WORKSPACE_NAME, MAX_REMEMBERED_WORKSPACES } from '@todoodle/shared/limits';
import { toPublicWorkspace } from '@todoodle/shared/schemas';
import { insertWorkspace, type WorkspaceRow } from '../db/workspaces';
import { type RememberedEntry, serializeRememberedCookie } from '../lib/cookie';
import { generateSecret, hashSecret } from '../lib/crypto';
import { errorResponse } from '../lib/errors';

/**
 * Tables emptied by POST /test/reset, children first (FK-safe order). Story 2 adds workspaces;
 * later stories append their tables (workspaces, tasks, projects, ...).
 */
export const TEST_RESET_TABLES: string[] = ['tasks', 'workspaces'];

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

/**
 * Seeds `count` workspaces ("Seeded 1" is the most recent) and returns a Set-Cookie remembering
 * all of them, oldest last. Body: { count: number } (1..MAX_REMEMBERED_WORKSPACES). For e2e TC-87.
 */
testRoutes.post('/remembered-seed', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { count?: unknown };
  const count = body.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_REMEMBERED_WORKSPACES) {
    return errorResponse('validation', 400);
  }
  const secrets = Array.from({ length: count }, () => generateSecret());
  const hashes = await Promise.all(secrets.map((s) => hashSecret(s)));
  const insert = c.env.DB.prepare('INSERT INTO workspaces (secret_hash, name) VALUES (?, ?) RETURNING *');
  const results = await c.env.DB.batch<WorkspaceRow>(hashes.map((hash, i) => insert.bind(hash, `Seeded ${i + 1}`)));
  const now = Math.floor(Date.now() / 1000);
  const entries: RememberedEntry[] = results.map((r, i) => ({ id: r.results[0]!.id, s: secrets[i]!, t: now - 60 * (i + 1) }));
  c.header('Set-Cookie', serializeRememberedCookie(entries, c.env));
  return c.json({ workspaces: results.map((r) => toPublicWorkspace(r.results[0]!)) }, 201);
});

/**
 * The stored task row exactly as in D1, deleted or not (story 6 retention checks, TC-E04).
 * 404 when no row has this id.
 */
testRoutes.get('/tasks/:id/raw', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(c.req.param('id')).first();
  return row ? c.json({ task: row }) : errorResponse('not_found', 404);
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
