import { act, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { countsQuery } from '@/features/tasks/queries';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { workspaceLoader } from '@/routes/workspaceLoader';
import { server } from '../../msw.ts';
import { countsHandler, listHandler } from '../../msw/tasks.ts';
import { gate, recordRequests } from '../../support/fixtures.ts';
import { ID, renderWithClient } from '../../support/tasks.tsx';

describe('shell.sidebar: workspaceLoader and query keys', () => {
  it('TC-91 starts GET tasks and GET counts together and returns without awaiting either', async () => {
    const hold = gate();
    server.use(listHandler({ until: hold.promise }), countsHandler({ until: hold.promise }));
    const seen = recordRequests();
    const result = workspaceLoader({ params: { workspaceId: ID } });
    // Synchronous: rendering is never blocked on the data.
    expect(result).toBeNull();
    await waitFor(() => expect([...seen].sort()).toEqual([`GET /api/w/${ID}/counts`, `GET /api/w/${ID}/tasks`]));
    // Both are in flight and neither has resolved.
    expect(queryClient.getQueryState(queryKeys.tasks(ID, { list: 'inbox' }))?.fetchStatus).toBe('fetching');
    expect(queryClient.getQueryState(queryKeys.counts(ID))?.fetchStatus).toBe('fetching');
    expect(queryClient.getQueryData(queryKeys.counts(ID))).toBeUndefined();
    hold.release();
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.counts(ID))).toEqual({ inbox: 0 }));
    expect(queryClient.getQueryData(queryKeys.tasks(ID, { list: 'inbox' }))).toEqual([]);
  });

  it('a loader call without an id does nothing', () => {
    const seen = recordRequests();
    expect(workspaceLoader({ params: {} })).toBeNull();
    expect(seen).toEqual([]);
  });

  it("TC-92 the counts key is ['ws', id, 'counts'] (no date); invalidating ['ws', id] refetches counts exactly once", async () => {
    expect(countsQuery(ID).queryKey).toEqual(['ws', ID, 'counts']);
    expect(queryKeys.tasks(ID, { list: 'inbox' })).toEqual(['ws', ID, 'tasks', { list: 'inbox' }]);
    let calls = 0;
    server.use(countsHandler({ counts: { inbox: 1 } }));
    const seen = recordRequests();
    function Probe() {
      useQuery(countsQuery(ID));
      return null;
    }
    await renderWithClient(<Probe />);
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.counts(ID))).toEqual({ inbox: 1 }));
    calls = seen.filter((r) => r.endsWith('/counts')).length;
    expect(calls).toBe(1);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.root(ID) });
    });
    await waitFor(() => expect(seen.filter((r) => r.endsWith('/counts'))).toHaveLength(2));
  });
});
