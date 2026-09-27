import { DEFAULT_WORKSPACE_NAME } from '@todoodle/shared/limits';
import { OpenWorkspaceBody, RenameWorkspaceBody, toPublicWorkspace, type Workspace } from '@todoodle/shared/schemas';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { findActiveBySecretHash, insertWorkspace, renameWorkspace } from '../db/workspaces';
import { readRemembered, serializeRememberedCookie, upsertRemembered } from '../lib/cookie';
import { generateSecret, hashSecret, isWellFormedSecret } from '../lib/crypto';
import { errorResponse, workspaceNotFound } from '../lib/errors';

/**
 * Hook point for story 4, which broadcasts `workspace.updated` to everyone in the workspace.
 * Deliberately a no-op until then.
 */
export function onWorkspaceUpdated(_env: AppEnv['Bindings'], _workspace: Workspace): void {}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Remembers the workspace in this browser's cookie; returns the Set-Cookie value and the drop count. */
function rememberWorkspace(
  cookieHeader: string | null,
  id: string,
  secret: string,
  env: AppEnv['Bindings'],
): { setCookie: string; dropped: number } {
  const { entries, dropped } = upsertRemembered(readRemembered(cookieHeader), { id, s: secret, t: nowSeconds() });
  return { setCookie: serializeRememberedCookie(entries, env), dropped };
}

/** Workspace API. Mounted at /api; /api/w/* routes sit behind workspace-auth (see app.ts). */
export const workspaceRoutes = new Hono<AppEnv>();

workspaceRoutes.post('/workspaces', async (c) => {
  const secret = generateSecret();
  const row = await insertWorkspace(c.env.DB, await hashSecret(secret), DEFAULT_WORKSPACE_NAME);
  const { setCookie, dropped } = rememberWorkspace(c.req.header('Cookie') ?? null, row.id, secret, c.env);
  c.header('Set-Cookie', setCookie);
  return c.json({ workspace: toPublicWorkspace(row), secret, dropped }, 201);
});

workspaceRoutes.post('/workspaces/open', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('validation', 400);
  }
  const parsed = OpenWorkspaceBody.safeParse(body);
  if (!parsed.success) return errorResponse('validation', 400);

  const { secret } = parsed.data;
  // Malformed, unknown and deleted secrets all get the same bytes back; malformed skips the DB.
  if (!isWellFormedSecret(secret)) return workspaceNotFound();
  const row = await findActiveBySecretHash(c.env.DB, await hashSecret(secret));
  if (!row) return workspaceNotFound();

  const { setCookie, dropped } = rememberWorkspace(c.req.header('Cookie') ?? null, row.id, secret, c.env);
  c.header('Set-Cookie', setCookie);
  return c.json({ workspace: toPublicWorkspace(row), dropped });
});

workspaceRoutes.get('/w/:workspaceId', (c) => c.json({ workspace: toPublicWorkspace(c.get('workspace')) }));

workspaceRoutes.patch('/w/:workspaceId', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('validation', 400);
  }
  const parsed = RenameWorkspaceBody.safeParse(body);
  if (!parsed.success) return errorResponse('validation', 400);

  const row = await renameWorkspace(c.env.DB, c.get('workspace').id, parsed.data.name);
  if (!row) return workspaceNotFound();
  const workspace = toPublicWorkspace(row);
  onWorkspaceUpdated(c.env, workspace);
  return c.json({ workspace });
});

/**
 * The full link, rebuilt from this browser's own verified cookie entry (the server stores no raw
 * secret). Called only on an explicit user action on the /w/:id route. Never logged.
 */
workspaceRoutes.get('/w/:workspaceId/link', (c) => {
  const link = `${new URL(c.req.url).origin}/w#${c.get('rememberedEntry').s}`;
  c.header('Cache-Control', 'no-store');
  return c.json({ link });
});
