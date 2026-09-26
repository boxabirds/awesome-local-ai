import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { getOpen, primeOpen, resetOpensForTests, startBootOpen, takeBootOpen } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { server } from '../msw.ts';
import { SECRET, WORKSPACE, openHandler } from '../support/fixtures.ts';

function loc(pathname: string, hash: string) {
  return { pathname, hash };
}

afterEach(() => {
  resetOpensForTests();
  queryClient.clear();
});

describe('TC-84 boot open', () => {
  it('fires exactly one open for /w with a hash, and none for other paths or an empty hash', async () => {
    const bodies: unknown[] = [];
    server.use(openHandler({ onRequest: (body) => bodies.push(body) }));

    expect(startBootOpen(loc('/w', ''))).toBeNull();
    expect(startBootOpen(loc('/w', '#'))).toBeNull();
    expect(startBootOpen(loc('/', `#${SECRET}`))).toBeNull();
    expect(startBootOpen(loc('/w/abc', `#${SECRET}`))).toBeNull();
    const promise = startBootOpen(loc('/w', `#${SECRET}`));
    expect(promise).not.toBeNull();
    await promise;
    expect(bodies).toEqual([{ secret: SECRET }]);
  });

  it('takeBootOpen returns the same promise for the same secret and null for another', async () => {
    server.use(openHandler());
    const promise = startBootOpen(loc('/w', `#${SECRET}`));
    expect(takeBootOpen(SECRET)).toBe(promise);
    expect(takeBootOpen(SECRET)).toBe(promise);
    expect(takeBootOpen(`${SECRET.slice(0, 42)}x`)).toBeNull();
    expect(getOpen(SECRET)).toBe(promise);
    await promise;
  });

  it('the then-callback writes queryKeys.workspace(id) into the cache', async () => {
    server.use(openHandler());
    const result = await startBootOpen(loc('/w', `#${SECRET}`));
    expect(result).toEqual({ status: 'ok', workspace: WORKSPACE });
    expect(queryClient.getQueryData(queryKeys.workspace(WORKSPACE.id))).toEqual(WORKSPACE);
  });

  it('maps 404/400 to not_found and 5xx/network to failed, without rejecting', async () => {
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'not_found', message: 'Workspace not found' }, { status: 404 })));
    expect(await startBootOpen(loc('/w', '#a'))).toEqual({ status: 'not_found' });
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'validation', message: 'x' }, { status: 400 })));
    expect(await startBootOpen(loc('/w', '#b'))).toEqual({ status: 'not_found' });
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'internal', message: 'x' }, { status: 500 })));
    expect(await startBootOpen(loc('/w', '#c'))).toEqual({ status: 'failed' });
    server.use(http.post('/api/workspaces/open', () => HttpResponse.error()));
    expect(await startBootOpen(loc('/w', '#d'))).toEqual({ status: 'failed' });
  });

  it('a primed open (after create) is already settled and makes no request', () => {
    primeOpen(SECRET, WORKSPACE);
    const promise = getOpen(SECRET) as Promise<unknown> & { status?: string; value?: unknown };
    expect(promise.status).toBe('fulfilled');
    expect(promise.value).toEqual({ status: 'ok', workspace: WORKSPACE });
  });
});
