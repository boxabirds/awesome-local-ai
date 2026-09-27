import { http, HttpResponse } from 'msw';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { SidebarContent } from '@/features/workspace/Sidebar';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';
import { workspaceLoader } from '@/routes/workspaceLoader';
import { deferred } from '../../render';
import { server } from '../../msw';
import { counts, TASK_WS_ID } from '../../msw/tasks';
import { renderWithProviders } from '../helpers';

describe('workspaceLoader', () => {
  it('TC-91 starts GET tasks and GET counts together and returns without awaiting either', async () => {
    const gate = deferred();
    const started: string[] = [];
    const answered: string[] = [];
    server.use(
      http.get('/api/w/:id/tasks', async () => {
        started.push('tasks');
        await gate.promise;
        answered.push('tasks');
        return HttpResponse.json({ tasks: [] });
      }),
      http.get('/api/w/:id/counts', async () => {
        started.push('counts');
        await gate.promise;
        answered.push('counts');
        return HttpResponse.json(counts(0));
      }),
    );
    const result = workspaceLoader({ params: { workspaceId: TASK_WS_ID } });
    expect(result).toBeNull();
    await expect.poll(() => [...started].sort()).toEqual(['counts', 'tasks']);
    expect(answered).toEqual([]);
    gate.resolve();
    await expect.poll(() => queryClient.getQueryData(qk.counts(TASK_WS_ID))).toEqual({ inbox: 0 });
    expect(queryClient.getQueryData(qk.tasks(TASK_WS_ID, { list: 'inbox' }))).toEqual([]);
  });

  it('does nothing without a workspace id', () => {
    expect(workspaceLoader({ params: {} })).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('TC-92 the counts key has no date; invalidating the workspace root refetches counts exactly once', async () => {
    expect(qk.counts(TASK_WS_ID)).toEqual(['ws', TASK_WS_ID, 'counts']);
    expect(qk.tasks(TASK_WS_ID, { list: 'inbox' })).toEqual(['ws', TASK_WS_ID, 'tasks', { list: 'inbox', includeCompleted: false }]);
    let gets = 0;
    server.use(
      http.get('/api/w/:id/counts', () => {
        gets++;
        return HttpResponse.json(counts(gets));
      }),
    );
    await renderWithProviders(createElement(SidebarContent, { workspaceId: TASK_WS_ID }));
    await expect.poll(() => gets).toBe(1);
    await queryClient.invalidateQueries({ queryKey: qk.root(TASK_WS_ID) });
    await expect.poll(() => gets).toBe(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(gets).toBe(2);
  });
});
