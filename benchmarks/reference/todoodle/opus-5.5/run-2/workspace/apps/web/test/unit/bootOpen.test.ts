import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { knownWorkspaceId, startBootOpen, takeBootOpen } from '@/features/workspace/bootOpen';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { OTHER_SECRET, SECRET, WS_ID, workspace } from '../fixtures';
import { server } from '../msw';

function countOpens() {
  const bodies: unknown[] = [];
  server.use(
    http.post('/api/workspaces/open', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ workspace: workspace(), dropped: 0 });
    }),
  );
  return bodies;
}

describe('boot open', () => {
  it('TC-84 fires exactly one open for /w with a hash, sending the secret in the body', async () => {
    const bodies = countOpens();
    const promise = startBootOpen({ pathname: '/w', hash: `#${SECRET}` });
    expect(promise).not.toBeNull();
    await promise;
    expect(bodies).toEqual([{ secret: SECRET }]);
  });

  it.each([
    ['/w without a hash', '/w', ''],
    ['/w with an empty hash', '/w', '#'],
    ['the home page', '/', `#${SECRET}`],
    ['the id route', `/w/${WS_ID}`, `#${SECRET}`],
    ['another path', '/elsewhere', `#${SECRET}`],
  ])('TC-84 fires nothing for %s', async (_label, pathname, hash) => {
    const bodies = countOpens();
    expect(startBootOpen({ pathname, hash })).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(bodies).toEqual([]);
  });

  it('TC-84 takeBootOpen returns the same promise for the same secret, null for another', () => {
    countOpens();
    const promise = startBootOpen({ pathname: '/w', hash: `#${SECRET}` });
    expect(takeBootOpen(SECRET)).toBe(promise);
    expect(takeBootOpen(SECRET)).toBe(promise);
    expect(takeBootOpen(OTHER_SECRET)).toBeNull();
  });

  it('TC-84 the promise continuation writes queryKeys.workspace(id)', async () => {
    countOpens();
    expect(queryClient.getQueryData(queryKeys.workspace(WS_ID))).toBeUndefined();
    await startBootOpen({ pathname: '/w', hash: `#${SECRET}` });
    expect(queryClient.getQueryData(queryKeys.workspace(WS_ID))).toEqual(workspace());
    expect(knownWorkspaceId(SECRET)).toBe(WS_ID);
  });

  it('TC-84 a failed boot open rejects without an unhandled rejection or a cache write', async () => {
    server.use(http.post('/api/workspaces/open', () => HttpResponse.json({ error: 'internal' }, { status: 500 })));
    const promise = startBootOpen({ pathname: '/w', hash: `#${SECRET}` });
    await expect(promise).rejects.toMatchObject({ status: 500 });
    expect(queryClient.getQueryData(queryKeys.workspace(WS_ID))).toBeUndefined();
  });

  it('TC-84 the open call puts nothing under a query key', async () => {
    countOpens();
    await startBootOpen({ pathname: '/w', hash: `#${SECRET}` });
    const keys = queryClient.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
    expect(keys.join()).not.toContain(SECRET);
  });
});
