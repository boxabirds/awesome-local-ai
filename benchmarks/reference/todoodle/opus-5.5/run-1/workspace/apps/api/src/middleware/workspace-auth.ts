import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.ts';
import { findActiveById } from '../db/workspaces.ts';
import { findEntry, readRemembered } from '../lib/cookie.ts';
import { hashSecret, hashesEqual } from '../lib/crypto.ts';
import { workspaceNotFound } from '../lib/errors.ts';

/**
 * Grants access to /api/w/:workspaceId only when this browser's remembered cookie holds a secret whose
 * hash matches the workspace. Every failure is the same 404. Never refreshes the cookie (only open does).
 */
export const workspaceAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const workspaceId = c.req.param('workspaceId');
  if (!workspaceId) return workspaceNotFound();
  const entry = findEntry(readRemembered(c.req.header('Cookie') ?? null), workspaceId);
  if (!entry) return workspaceNotFound();
  const row = await findActiveById(c.env.DB, workspaceId);
  if (!row) return workspaceNotFound();
  if (!hashesEqual(row.secret_hash, await hashSecret(entry.s))) return workspaceNotFound();
  c.set('workspace', row);
  c.set('rememberedEntry', entry);
  await next();
};
