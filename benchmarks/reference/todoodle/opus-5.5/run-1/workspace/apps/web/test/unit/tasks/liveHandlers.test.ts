import { QueryClient } from '@tanstack/react-query';
import type { LiveEvent } from '@todoodle/shared/events';
import type { Counts, Task } from '@todoodle/shared/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchDeps, dispatchEvent } from '@/features/live/dispatch';
import { clearLiveHandlersForTests } from '@/features/live/registry';
import { registerTaskLiveHandlers } from '@/features/tasks/liveHandlers';
import { queryKeys } from '@/lib/queryKeys';
import { makeTask } from '../../msw/tasks.ts';

// Story 6, TC-U09: task.restored (and task.deleted / completion upserts) through story 4's registry.

const WS = '0123456789ABCDEF0123456789ABCDEF';
const OPEN_KEY = queryKeys.tasks(WS, { list: 'inbox' });
const ALL_KEY = queryKeys.tasks(WS, { list: 'inbox', includeCompleted: true });
const COUNTS_KEY = queryKeys.counts(WS);

function setup(open: Task[], all?: Task[], inbox = open.length) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(OPEN_KEY, open);
  if (all) queryClient.setQueryData(ALL_KEY, all);
  queryClient.setQueryData<Counts>(COUNTS_KEY, { inbox });
  const unregister = registerTaskLiveHandlers();
  const deps = dispatchDeps({ clientId: 'me', announcer: { record: () => {} }, notifyGuards: () => {} });
  const send = (event: Omit<LiveEvent, 'originClientId'>) =>
    dispatchEvent({ queryClient, workspaceId: WS }, { ...event, originClientId: 'someone-else' }, deps);
  return { queryClient, unregister, send };
}

const A = makeTask({ name: 'Buy milk' }, 0);
const B = makeTask({ name: 'Email Sam re: invoice #4411', version: 3 }, 1);
const C = makeTask({ name: 'Call Mum 📞' }, 2);

describe('TC-U09 task.restored via registerLiveHandler', () => {
  afterEach(() => clearLiveHandlersForTests());

  it('a lower or equal version than the cached copy is ignored; a higher one is applied', () => {
    const { queryClient, send } = setup([A, B, C]);
    expect(send({ type: 'task.restored', entity: { ...B, version: 2 }, version: 2 } as never)).toBe('stale');
    expect(send({ type: 'task.restored', entity: { ...B, name: 'Equal', version: 3 }, version: 3 } as never)).toBe('stale');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.[1]?.name).toBe(B.name);
    expect(send({ type: 'task.restored', entity: { ...B, name: 'Newer', version: 4 }, version: 4 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.name)).toEqual([A.name, 'Newer', C.name]);
  });

  it('a restored task we no longer have is inserted at its sortOrder in every cached list; the count goes up', () => {
    const done = makeTask({ name: 'Water the plants', completedAt: '2026-09-20T10:00:00.000Z' }, 9);
    const { queryClient, send } = setup([A, C], [A, C, done], 2);
    expect(send({ type: 'task.restored', entity: { ...B, version: 5 }, version: 5 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.id)).toEqual([A.id, B.id, C.id]);
    expect(queryClient.getQueryData<Task[]>(ALL_KEY)?.map((t) => t.id)).toEqual([A.id, B.id, C.id, done.id]);
    expect(queryClient.getQueryData<Counts>(COUNTS_KEY)).toEqual({ inbox: 3 });
  });

  it('a restored completed task joins only the completed group', () => {
    const doneB = { ...B, completedAt: '2026-09-22T10:00:00.000Z', version: 5 };
    const { queryClient, send } = setup([A, C], [A, C], 2);
    expect(send({ type: 'task.restored', entity: doneB, version: 5 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.id)).toEqual([A.id, C.id]);
    expect(queryClient.getQueryData<Task[]>(ALL_KEY)?.map((t) => t.id)).toEqual([A.id, C.id, B.id]);
    expect(queryClient.getQueryData<Counts>(COUNTS_KEY)).toEqual({ inbox: 2 });
  });
});

describe('task.deleted and completion upserts', () => {
  afterEach(() => clearLiveHandlersForTests());

  it('task.deleted removes the task from every list and lowers the count; stale versions are ignored', () => {
    const { queryClient, send } = setup([A, B, C], [A, B, C]);
    expect(send({ type: 'task.deleted', entity: { id: B.id }, version: 3 } as never)).toBe('stale');
    expect(send({ type: 'task.deleted', entity: { id: B.id }, version: 4 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.id)).toEqual([A.id, C.id]);
    expect(queryClient.getQueryData<Task[]>(ALL_KEY)?.map((t) => t.id)).toEqual([A.id, C.id]);
    expect(queryClient.getQueryData<Counts>(COUNTS_KEY)).toEqual({ inbox: 2 });
  });

  it('someone completing a task removes it from the open list and moves it to the completed group', () => {
    const { queryClient, send } = setup([A, B, C], [A, B, C]);
    const completed = { ...A, completedAt: '2026-09-26T08:00:00.000Z', version: 2 };
    expect(send({ type: 'task.upserted', entity: completed, version: 2 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.id)).toEqual([B.id, C.id]);
    expect(queryClient.getQueryData<Task[]>(ALL_KEY)?.map((t) => t.id)).toEqual([B.id, C.id, A.id]);
    expect(queryClient.getQueryData<Counts>(COUNTS_KEY)).toEqual({ inbox: 2 });
  });

  it('someone reopening a task puts it back at its sortOrder', () => {
    const doneA = { ...A, completedAt: '2026-09-26T08:00:00.000Z', version: 2 };
    const { queryClient, send } = setup([B, C], [B, C, doneA], 2);
    expect(send({ type: 'task.upserted', entity: { ...A, version: 3 }, version: 3 } as never)).toBe('applied');
    expect(queryClient.getQueryData<Task[]>(OPEN_KEY)?.map((t) => t.id)).toEqual([A.id, B.id, C.id]);
    expect(queryClient.getQueryData<Task[]>(ALL_KEY)?.map((t) => t.id)).toEqual([A.id, B.id, C.id]);
    expect(queryClient.getQueryData<Counts>(COUNTS_KEY)).toEqual({ inbox: 3 });
  });
});
