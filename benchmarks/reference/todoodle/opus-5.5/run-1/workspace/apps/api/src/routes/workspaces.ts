import { DEFAULT_WORKSPACE_NAME } from '@todoodle/shared/limits';
import { OpenWorkspaceBody, RenameWorkspaceBody, toPublicWorkspace } from '@todoodle/shared/schemas';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { findActiveBySecretHash, insertWorkspace, renameWorkspace } from '../db/workspaces.ts';
import { readRemembered, serializeRememberedCookie, upsertRemembered } from '../lib/cookie.ts';
import { generateSecret, hashSecret, isWellFormedSecret } from '../lib/crypto.ts';
import { errorResponse, workspaceNotFound } from '../lib/errors.ts';
import { broadcast } from '../live/broadcast.ts';
import { hasBody } from '../middleware/validate.ts';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Reads a JSON body; undefined when there is none, null when it is not valid JSON. */
async function readJson(req: Request): Promise<unknown> {
  if (!hasBody(req)) return undefined;
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Adds or refreshes this workspace in the browser's remembered cookie. Returns how many old entries were evicted. */
function remember(c: Context<AppEnv>, id: string, secret: string): number {
  const { entries, dropped } = upsertRemembered(readRemembered(c.req.header('Cookie') ?? null), { id, s: secret, t: nowSeconds() });
  c.header('Set-Cookie', serializeRememberedCookie(entries, c.env));
  return dropped;
}

/** Routes under /api/workspaces. Handlers never log request bodies, secrets or cookies. */
export const workspacesRoutes = new Hono<AppEnv>();

workspacesRoutes.post('/', async (c) => {
  const body = await readJson(c.req.raw);
  if (body === null || (body !== undefined && (typeof body !== 'object' || Array.isArray(body)))) {
    return errorResponse('validation', 400);
  }
  const secret = generateSecret();
  const row = await insertWorkspace(c.env.DB, await hashSecret(secret), DEFAULT_WORKSPACE_NAME);
  const dropped = remember(c, row.id, secret);
  return c.json({ workspace: toPublicWorkspace(row), secret, dropped }, 201);
});

workspacesRoutes.post('/open', async (c) => {
  const parsed = OpenWorkspaceBody.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  const { secret } = parsed.data;
  // Malformed secrets never reach the database; they get the same answer as unknown ones.
  if (!isWellFormedSecret(secret)) return workspaceNotFound();
  const row = await findActiveBySecretHash(c.env.DB, await hashSecret(secret));
  if (!row) return workspaceNotFound();
  const dropped = remember(c, row.id, secret);
  return c.json({ workspace: toPublicWorkspace(row), dropped });
});

/** Routes under /api/w/:workspaceId, mounted behind workspace-auth (c.var.workspace is verified). */
export const workspaceRoutes = new Hono<AppEnv>();

workspaceRoutes.get('/', (c) => c.json({ workspace: toPublicWorkspace(c.var.workspace) }));

workspaceRoutes.patch('/', async (c) => {
  const parsed = RenameWorkspaceBody.safeParse(await readJson(c.req.raw));
  if (!parsed.success) return errorResponse('validation', 400);
  // Story 4: renaming to the current name is a no-op write: no version bump and no broadcast.
  if (parsed.data.name === c.var.workspace.name) return c.json({ workspace: toPublicWorkspace(c.var.workspace) });
  // Null when the workspace was deleted between auth and the update.
  const row = await renameWorkspace(c.env.DB, c.var.workspace.id, parsed.data.name);
  if (!row) return workspaceNotFound();
  const workspace = toPublicWorkspace(row);
  // After the write commits: everyone else with the workspace open sees the new name.
  broadcast(c, workspace.id, { type: 'workspace.updated', entity: workspace, version: workspace.version });
  return c.json({ workspace });
});

/**
 * GET /api/w/:workspaceId/link: rebuilds the link from this browser's verified cookie entry (the server
 * stores no raw secret). Only called on an explicit user action. Never logged, never cached.
 */
workspaceRoutes.get('/link', (c) => {
  const link = `${new URL(c.req.url).origin}/w#${c.var.rememberedEntry.s}`;
  c.header('Cache-Control', 'no-store');
  return c.json({ link });
});
