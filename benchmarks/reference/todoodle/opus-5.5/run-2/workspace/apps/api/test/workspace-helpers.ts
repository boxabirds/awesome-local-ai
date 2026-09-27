import { env, SELF } from 'cloudflare:test';
import type { Workspace } from '@todoodle/shared/schemas';
import type { WorkspaceRow } from '../src/db/workspaces';
import { readRemembered, type RememberedEntry, serializeRememberedCookie } from '../src/lib/cookie';
import { CLIENT_HEADERS, ORIGIN } from './helpers';

export type Created = { workspace: Workspace; secret: string; dropped: number; cookie: string };

/** The `tdl_ws=...` pair from a response's Set-Cookie, ready to send back as a Cookie header. */
export function cookieFrom(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0]! : null;
}

export function entriesFrom(res: Response): RememberedEntry[] {
  return readRemembered(cookieFrom(res));
}

/** A Cookie header for hand-picked entries (built with the real codec). */
export function cookieFor(entries: RememberedEntry[]): string {
  return serializeRememberedCookie(entries, { ENVIRONMENT: 'local' }).split(';')[0]!;
}

export function post(path: string, init: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...CLIENT_HEADERS, ...init.headers };
  if (init.body !== undefined) headers['Content-Type'] ??= 'application/json';
  if (init.cookie) headers.Cookie = init.cookie;
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
}

export function get(path: string, cookie?: string | null) {
  return SELF.fetch(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

export function patch(path: string, body: unknown, cookie?: string | null, headers: Record<string, string> = CLIENT_HEADERS) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Creates a workspace through the real API, carrying the given cookie forward. */
export async function createWorkspace(cookie?: string | null): Promise<Created> {
  const res = await post('/api/workspaces', { cookie });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  const body = (await res.json()) as Omit<Created, 'cookie'>;
  return { ...body, cookie: cookieFrom(res)! };
}

export async function seedDeletedWorkspace(): Promise<{ workspace: Workspace; secret: string }> {
  const res = await post('/test/seed-workspace', { body: { deleted: true } });
  return (await res.json()) as { workspace: Workspace; secret: string };
}

export async function countWorkspaces(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>();
  return row?.n ?? 0;
}

export function rowById(id: string): Promise<WorkspaceRow | null> {
  return env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
}

export function randomHexId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function del(path: string, cookie?: string | null, headers: Record<string, string> = CLIENT_HEADERS) {
  return SELF.fetch(`${ORIGIN}${path}`, { method: 'DELETE', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) } });
}

/** A workspace with a chosen name (through the non-production seed route), plus its secret. */
export async function seedNamedWorkspace(name: string): Promise<{ workspace: Workspace; secret: string }> {
  const res = await post('/test/seed-workspace', { body: { name } });
  if (res.status !== 201) throw new Error(`seed failed: ${res.status}`);
  return (await res.json()) as { workspace: Workspace; secret: string };
}
