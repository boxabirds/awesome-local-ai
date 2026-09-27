import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { DEFAULT_WORKSPACE_NAME, MAX_REMEMBERED_WORKSPACES } from '@todoodle/shared/limits';
import { CreateProjectInputSchema, CreateTaskInputSchema, toPublicWorkspace } from '@todoodle/shared/schemas';
import { z } from 'zod';
import { deleteProjectBatch, insertProjectIdempotent } from '../db/projects.ts';
import { insertTasksForSeed, readRawTask, rowToTask } from '../db/tasks.ts';
import { insertWorkspace } from '../db/workspaces.ts';
import { type RememberedEntry, serializeRememberedCookie } from '../lib/cookie.ts';
import { generateSecret, hashSecret } from '../lib/crypto.ts';
import { errorResponse } from '../lib/errors.ts';

/**
 * Tables emptied by POST /test/reset, children first so foreign keys are never violated.
 * Stories append their tables here (e.g. tasks and projects go before workspaces).
 */
export const TEST_RESET_TABLES: string[] = ['tasks', 'projects', 'workspaces'];

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

/** Story 6: the stored task row whatever its state (deleted rows too), so e2e can prove soft delete keeps data. */
testRoutes.get('/tasks/:id/raw', async (c) => {
  const row = await readRawTask(c.env.DB, c.req.param('id'));
  return row ? c.json({ task: row }) : errorResponse('not_found', 404);
});

/**
 * Story 7 (TC-29): runs one SQL statement against the local database, e.g. to install or drop a trigger that
 * aborts a project UPDATE and so prove the delete batch is atomic. Body: { sql: string }. Never in production.
 */
testRoutes.post('/sql', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { sql?: unknown };
  if (typeof body.sql !== 'string' || body.sql.trim() === '') return errorResponse('validation', 400);
  await c.env.DB.prepare(body.sql).run();
  return c.json({ ok: true });
});

const SeedBody = z.object({
  workspaceId: z.string().min(1),
  projects: z.array(CreateProjectInputSchema.extend({ deleted: z.boolean().optional() })).default([]),
  tasks: z
    .array(CreateTaskInputSchema.extend({ completedAt: z.string().nullable().optional(), deleted: z.boolean().optional() }))
    .default([]),
});

/**
 * Story 8: seeds realistic fixtures through the same db modules the API uses (not hand-written rows): projects
 * (the create statement; `deleted` deletes one with its tasks exactly as a project delete does) and tasks (the
 * quick-add insert, with dueDate), then marks tasks completed (`completedAt`) or soft-deleted (`deleted`).
 * Body: { workspaceId, projects?: [{id, name, color, deleted?}], tasks?: [{id, name, description?, projectId?,
 * dueDate?, completedAt?, deleted?}] }. Tasks are inserted in batches, so 5,000 of them stay quick.
 */
testRoutes.post('/seed', async (c) => {
  const parsed = SeedBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse('validation', 400);
  const { workspaceId, projects, tasks } = parsed.data;
  const db = c.env.DB;
  for (const project of projects) {
    const result = await insertProjectIdempotent(db, { id: project.id, workspaceId, name: project.name, color: project.color });
    if (result.status !== 'created' && result.status !== 'replayed') return errorResponse("validation", 409);
  }
  const rows = await insertTasksForSeed(
    db,
    tasks.map((task) => ({ ...task, workspaceId })),
  );
  const states = tasks.filter((task) => task.completedAt || task.deleted);
  if (states.length > 0) {
    await db.batch(
      states.map((task) =>
        db
          .prepare(
            `UPDATE tasks SET completed_at = COALESCE(?1, completed_at),
               deleted = CASE WHEN ?2 THEN 1 ELSE deleted END, deleted_at = CASE WHEN ?2 THEN datetime('now') ELSE deleted_at END
             WHERE id = ?3 AND workspace_id = ?4`,
          )
          .bind(task.completedAt ?? null, task.deleted ? 1 : 0, task.id, workspaceId),
      ),
    );
  }
  const now = new Date().toISOString();
  for (const project of projects.filter((p) => p.deleted)) {
    const batchId = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await deleteProjectBatch(db, workspaceId, project.id, batchId, now);
  }
  return c.json({ tasks: rows.map(rowToTask) }, 201);
});

testRoutes.get('/throw', () => {
  throw new Error('Deliberate failure from /test/throw');
});

testRoutes.all('*', () => errorResponse('not_found', 404));
