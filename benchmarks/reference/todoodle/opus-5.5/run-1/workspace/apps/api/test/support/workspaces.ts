import { SELF, env } from 'cloudflare:test';
import { expect } from 'vitest';
import type { WorkspaceRow } from '../../src/db/workspaces.ts';
import { type RememberedEntry, encodeRemembered, readRemembered } from '../../src/lib/cookie.ts';
import { CLIENT, url } from './http.ts';

export type Workspace = { id: string; name: string; version: number; createdAt: string };
export type Created = { workspace: Workspace; secret: string; dropped: number };

export const JSON_CLIENT = { ...CLIENT, 'Content-Type': 'application/json' } as const;

/**
 * A browser's cookie jar for the tdl_ws cookie: sends it on every request and applies Set-Cookie
 * from every response, as a real browser would for Path=/api.
 */
export class Browser {
  cookie: string | undefined;

  constructor(cookie?: string) {
    this.cookie = cookie;
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('Cookie', this.cookie);
    const res = await SELF.fetch(url(path), { ...init, headers });
    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return res;
  }

  entries(): RememberedEntry[] {
    return readRemembered(this.cookie ?? null);
  }

  async create(): Promise<Created> {
    const res = await this.fetch('/api/workspaces', { method: 'POST', headers: CLIENT });
    expect(res.status).toBe(201);
    return (await res.json()) as Created;
  }

  open(secret: unknown): Promise<Response> {
    return this.fetch('/api/workspaces/open', { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify({ secret }) });
  }

  get(id: string): Promise<Response> {
    return this.fetch(`/api/w/${id}`);
  }

  rename(id: string, name: unknown, headers: Record<string, string> = JSON_CLIENT): Promise<Response> {
    return this.fetch(`/api/w/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ name }) });
  }
}

/** A cookie header built from explicit entries (e.g. a tampered secret). */
export function cookieFor(entries: RememberedEntry[]): string {
  return `tdl_ws=${encodeRemembered(entries)}`;
}

export async function seedWorkspace(body: { name?: string; deleted?: boolean } = {}): Promise<Created> {
  const res = await SELF.fetch(url('/test/seed-workspace'), { method: 'POST', headers: JSON_CLIENT, body: JSON.stringify(body) });
  expect(res.status).toBe(201);
  return (await res.json()) as Created;
}

export async function countWorkspaces(): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM workspaces').first<{ n: number }>())?.n ?? 0;
}

export async function rowById(id: string): Promise<WorkspaceRow | null> {
  return env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<WorkspaceRow>();
}

export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
