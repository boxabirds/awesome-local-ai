import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { findActiveById } from '../db/workspaces';
import { findEntry, readRemembered } from '../lib/cookie';
import { hashesEqual, hashSecret } from '../lib/crypto';
import { workspaceNotFound } from '../lib/errors';

/**
 * Guards every /api/w/:workspaceId route: this browser's cookie must hold an entry for the id
 * whose secret hashes to the stored secret_hash. Every failure is the same 404. The cookie is
 * never refreshed here (only open does that).
 */
export const workspaceAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param('workspaceId');
  if (!id) return workspaceNotFound();
  const entry = findEntry(readRemembered(c.req.header('Cookie') ?? null), id);
  if (!entry) return workspaceNotFound();
  const row = await findActiveById(c.env.DB, id);
  if (!row) return workspaceNotFound();
  if (!hashesEqual(row.secret_hash, await hashSecret(entry.s))) return workspaceNotFound();
  c.set('workspace', row);
  c.set('rememberedEntry', entry);
  await next();
};
