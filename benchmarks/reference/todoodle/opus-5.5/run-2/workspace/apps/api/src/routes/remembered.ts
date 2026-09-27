import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { RememberedListResponse } from '@todoodle/shared/schemas';
import {
  clearRememberedCookieHeader,
  encodeRemembered,
  inspectRemembered,
  readRemembered,
  rememberedCookieHeader,
  removeRemembered,
  touchRemembered,
} from '../lib/cookie';
import { workspaceNotFound } from '../lib/errors';
import { listRemembered, verifiedRows } from '../lib/remembered';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * This browser's remembered workspaces (the `tdl_ws` cookie). Mounted at /api/remembered.
 * The CSRF header rule for POST/DELETE is applied app-wide by the validate middleware.
 * Cookie values are never logged.
 */
export const rememberedRoutes = new Hono<AppEnv>();

/** Opening by id: moves a verified entry to the front. Absent, deleted or mismatched -> 404. */
rememberedRoutes.post('/:id/touch', async (c) => {
  const id = c.req.param('id');
  const entries = readRemembered(c.req.header('Cookie') ?? null);
  const touched = touchRemembered(entries, id, nowSeconds());
  if (!touched) return workspaceNotFound();
  const entry = entries.find((e) => e.id === id)!;
  const verified = await verifiedRows(c.env.DB, [entry]);
  if (!verified.has(id)) return workspaceNotFound();
  c.header('Set-Cookie', rememberedCookieHeader(encodeRemembered(touched), c.env));
  return c.body(null, 204);
});

/**
 * The list, most recent first, names only for workspaces this browser can still open. A cookie
 * that doesn't decode is healed: empty list plus a clearing Set-Cookie, never a 500.
 */
rememberedRoutes.get('/', async (c) => {
  const { entries, malformed } = inspectRemembered(c.req.header('Cookie') ?? null);
  if (malformed) c.header('Set-Cookie', clearRememberedCookieHeader(c.env));
  const workspaces = entries.length === 0 ? [] : await listRemembered(c.env.DB, entries);
  c.header('Cache-Control', 'no-store');
  return c.json(RememberedListResponse.parse({ workspaces }));
});

/**
 * Forget on this browser only: never reads or writes D1. Idempotent, and an id that isn't
 * remembered gets the same 204 (without Set-Cookie), so the answer reveals nothing.
 */
rememberedRoutes.delete('/:id', (c) => {
  const { entries, changed } = removeRemembered(readRemembered(c.req.header('Cookie') ?? null), c.req.param('id'));
  if (changed) c.header('Set-Cookie', rememberedCookieHeader(encodeRemembered(entries), c.env));
  return c.body(null, 204);
});
