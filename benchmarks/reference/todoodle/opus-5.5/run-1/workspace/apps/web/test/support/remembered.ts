import { RememberedListResponse, type RememberedPublic, Workspace, WorkspaceResponse } from '@todoodle/shared/schemas';
import axe from 'axe-core';
import { http, HttpResponse } from 'msw';
import { expect } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';

const MINUTE = 60_000;

/** A remembered entry as GET /api/remembered returns it (parsed through the shared strict schema). */
export function remembered(id: string, name: string | null, minutesAgo = 5): RememberedPublic {
  return RememberedListResponse.parse({
    workspaces: [{ id, name, lastOpenedAt: new Date(Date.now() - minutesAgo * MINUTE).toISOString(), available: name !== null }],
  }).workspaces[0]!;
}

// Real 32-hex ids; names include unicode and emoji.
export const A = remembered('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'Groceries 🛒', 0);
export const B = remembered('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 'Café work', 120);
export const C = remembered('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'Holiday', 24 * 60);
export const X = remembered('DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', null, 60);
export const Y = remembered('EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', null, 90);

export function workspaceFor(entry: RememberedPublic, name = entry.name ?? 'x'): Workspace {
  return Workspace.parse({ id: entry.id, name, version: 3, createdAt: '2026-09-01 10:00:00' });
}

type ListOpts = { status?: number; until?: Promise<unknown>; onRequest?: () => void };

/** GET /api/remembered returning `list` (or an error status). */
export function rememberedHandler(list: RememberedPublic[], { status = 200, until, onRequest }: ListOpts = {}) {
  return http.get('/api/remembered', async () => {
    onRequest?.();
    await until;
    if (status !== 200) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return HttpResponse.json(RememberedListResponse.parse({ workspaces: list }));
  });
}

/** DELETE /api/remembered/:id. */
export function forgetHandler({ status = 204, until, onRequest }: { status?: number; until?: Promise<unknown>; onRequest?: (id: string) => void } = {}) {
  return http.delete('/api/remembered/:id', async ({ params }) => {
    onRequest?.(String(params.id));
    await until;
    if (status !== 204) return HttpResponse.json({ error: 'internal', message: 'x' }, { status });
    return new HttpResponse(null, { status: 204 });
  });
}

/** GET /api/w/:id answering each id with its own workspace (404 for unknown ids). */
export function workspacesHandler(workspaces: Workspace[], { until }: { until?: Promise<unknown> } = {}) {
  const byId = new Map(workspaces.map((w) => [w.id, w]));
  return http.get('/api/w/:id', async ({ params }) => {
    await until;
    const workspace = byId.get(String(params.id));
    if (!workspace) return HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 });
    return HttpResponse.json(WorkspaceResponse.parse({ workspace }));
  });
}

/** Puts the remembered list in the cache, as if Home had already loaded it. */
export function cacheRemembered(list: RememberedPublic[]) {
  queryClient.setQueryData(queryKeys.remembered(), list);
}

export function savedKey(id: string) {
  return `tdl:v1:linkSaved:${id}`;
}

export function markSaved(id: string) {
  localStorage.setItem(savedKey(id), '1');
}

/** Stubs matchMedia so '(hover: none)' matches or not (touch vs mouse). */
export function stubHoverNone(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('hover: none') ? matches : false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
}

/** Runs axe on the document. Layout-dependent rules (contrast) are off: happy-dom does no layout. */
export async function expectNoAxeViolations(context: Element = document.body) {
  const results = await axe.run(context, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
