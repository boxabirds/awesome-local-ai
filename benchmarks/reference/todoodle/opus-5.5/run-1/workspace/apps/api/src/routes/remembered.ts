import { RememberedListResponse } from '@todoodle/shared/schemas';
import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import {
  clearRememberedCookieHeader,
  findEntry,
  parseRememberedCookie,
  readRemembered,
  removeRemembered,
  serializeRememberedCookie,
  touchRemembered,
} from '../lib/cookie.ts';
import { workspaceNotFound } from '../lib/errors.ts';
import { listRemembered, verifyRemembered } from '../lib/remembered.ts';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Routes under /api/remembered: this browser's list of workspaces, kept in the HttpOnly tdl_ws cookie.
 * Browser-scoped, so no workspace-auth; every mutation still passes the CSRF (client header) check.
 * Responses never contain secrets and handlers never log the cookie.
 */
export const rememberedRoutes = new Hono<AppEnv>();

/**
 * POST /api/remembered/:id/touch: open by id. Moves the entry to the front with a fresh last-opened time.
 * 404 (cookie unchanged) when the id is not remembered or its secret no longer verifies.
 */
rememberedRoutes.post('/:id/touch', async (c) => {
  const entries = readRemembered(c.req.header('Cookie') ?? null);
  const entry = findEntry(entries, c.req.param('id'));
  if (!entry) return workspaceNotFound();
  const [verified] = await verifyRemembered(c.env.DB, [entry]);
  if (!verified?.row) return workspaceNotFound();
  const touched = touchRemembered(entries, entry.id, nowSeconds());
  if (!touched) return workspaceNotFound();
  c.header('Set-Cookie', serializeRememberedCookie(touched, c.env));
  return c.body(null, 204);
});

/**
 * GET /api/remembered: {workspaces: [{id, name, lastOpenedAt, available}]} in cookie order. The body is
 * parsed through the strict shared schema, so an extra key (such as a secret) fails loudly instead of
 * leaking. A malformed cookie is healed: empty list plus a clearing Set-Cookie, never a 500.
 */
rememberedRoutes.get('/', async (c) => {
  const cookie = parseRememberedCookie(c.req.header('Cookie') ?? null);
  if (cookie.status === 'malformed') c.header('Set-Cookie', clearRememberedCookieHeader(c.env));
  const entries = cookie.status === 'ok' ? cookie.entries : [];
  const workspaces = entries.length > 0 ? await listRemembered(c.env.DB, entries) : [];
  c.header('Cache-Control', 'no-store');
  return c.json(RememberedListResponse.parse({ workspaces }));
});

/**
 * DELETE /api/remembered/:id: forget on this browser only. Always 204 (idempotent, reveals nothing);
 * Set-Cookie only when the id was remembered. Never reads or writes D1, so the workspace and everyone
 * else's access are untouched.
 */
rememberedRoutes.delete('/:id', (c) => {
  const { entries, changed } = removeRemembered(readRemembered(c.req.header('Cookie') ?? null), c.req.param('id'));
  if (changed) c.header('Set-Cookie', serializeRememberedCookie(entries, c.env));
  return c.body(null, 204);
});
