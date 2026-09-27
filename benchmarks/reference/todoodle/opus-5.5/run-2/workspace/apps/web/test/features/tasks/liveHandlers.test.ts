import type { LiveEvent } from '@todoodle/shared/events';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { handlersFor } from '@/features/live/registry';
import { applyTaskDeleted, applyTaskRestored, applyTaskUpserted, registerTaskHandlers } from '@/features/tasks/liveHandlers';
import type { LocalTask } from '@/features/tasks/localTask';
import { taskTombstones } from '@/features/tasks/taskLists';
import { qk } from '@/lib/queryKeys';
import { TASK_WS_ID, task, tasksNamed } from '../../msw/tasks';

const openKey = qk.tasks(TASK_WS_ID, { list: 'inbox' });
const fullKey = qk.tasks(TASK_WS_ID, { list: 'inbox', includeCompleted: true });

function setup() {
  const queryClient = new QueryClient();
  const [milk, invoice, mum] = tasksNamed('Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞');
  queryClient.setQueryData(openKey, [milk!, mum!]);
  queryClient.setQueryData(fullKey, [milk!, mum!]);
  queryClient.setQueryData(qk.counts(TASK_WS_ID), { inbox: 2 });
  return { ctx: { queryClient, workspaceId: TASK_WS_ID }, queryClient, milk: milk!, invoice: invoice!, mum: mum! };
}

const ids = (client: QueryClient, key: readonly unknown[]) => client.getQueryData<LocalTask[]>(key)?.map((t) => t.name);
const restored = (entity: LocalTask, version: number) =>
  ({ type: 'task.restored', entity, version, originClientId: null }) as Extract<LiveEvent, { type: 'task.restored' }>;

afterEach(() => taskTombstones.resetForTests());

describe('TC-U09 task.restored handler', () => {
  it('is registered through registerLiveHandler alongside the other task handlers', () => {
    const off = registerTaskHandlers();
    expect(handlersFor('task.restored').has(applyTaskRestored as never)).toBe(true);
    expect(handlersFor('task.deleted').has(applyTaskDeleted as never)).toBe(true);
    expect(handlersFor('task.upserted').has(applyTaskUpserted as never)).toBe(true);
    off();
    expect(handlersFor('task.restored').has(applyTaskRestored as never)).toBe(false);
  });

  it('a lower or equal version than the deletion is ignored; a higher one is inserted at its sortOrder', () => {
    const { ctx, queryClient, invoice } = setup();
    // The invoice task (sortOrder 2) was deleted at version 3.
    const deleted = { type: 'task.deleted', entity: { id: invoice.id }, version: 3, originClientId: null } as const;
    applyTaskDeleted(ctx, deleted);
    expect(applyTaskRestored(ctx, restored({ ...invoice, version: 2 }, 2))).toBe('stale');
    expect(applyTaskRestored(ctx, restored({ ...invoice, version: 3 }, 3))).toBe('stale');
    expect(ids(queryClient, openKey)).toEqual(['Buy milk', 'Call Mum 📞']);
    expect(applyTaskRestored(ctx, restored({ ...invoice, version: 4 }, 4))).toBe('applied');
    expect(ids(queryClient, openKey)).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    expect(ids(queryClient, fullKey)).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    expect(queryClient.getQueryData(qk.counts(TASK_WS_ID))).toEqual({ inbox: 3 });
  });

  it('a cached task with an equal or newer version is left alone', () => {
    const { ctx, queryClient, milk } = setup();
    const before = queryClient.getQueryData(openKey);
    expect(applyTaskRestored(ctx, restored(milk, milk.version))).toBe('stale');
    expect(queryClient.getQueryData(openKey)).toBe(before);
  });

  it('a restored completed task only goes to lists with completed tasks', () => {
    const { ctx, queryClient } = setup();
    const done = task({ name: 'Renew passport', sortOrder: 0.5, completedAt: '2026-09-26T07:45:00.000Z', version: 5 });
    expect(applyTaskRestored(ctx, restored(done, 5))).toBe('applied');
    expect(ids(queryClient, openKey)).toEqual(['Buy milk', 'Call Mum 📞']);
    expect(ids(queryClient, fullKey)).toEqual(['Buy milk', 'Call Mum 📞', 'Renew passport']);
  });
});

describe('task.upserted and task.deleted (story 6)', () => {
  it('someone completing a task removes it from the open list, moves it in the full list, and counts it', () => {
    const { ctx, queryClient, milk } = setup();
    const event = {
      type: 'task.upserted',
      entity: { ...milk, completedAt: '2026-09-27T10:00:00.000Z', version: 2 },
      version: 2,
      originClientId: null,
    } as const;
    expect(applyTaskUpserted(ctx, event)).toBe('applied');
    expect(ids(queryClient, openKey)).toEqual(['Call Mum 📞']);
    expect(ids(queryClient, fullKey)).toEqual(['Call Mum 📞', 'Buy milk']);
    expect(queryClient.getQueryData(qk.counts(TASK_WS_ID))).toEqual({ inbox: 1 });
  });

  it('an upsert for a task deleted here is ignored (it predates the deletion)', () => {
    const { ctx, queryClient, mum } = setup();
    applyTaskDeleted(ctx, { type: 'task.deleted', entity: { id: mum.id }, version: 2, originClientId: null });
    expect(ids(queryClient, openKey)).toEqual(['Buy milk']);
    expect(queryClient.getQueryData(qk.counts(TASK_WS_ID))).toEqual({ inbox: 1 });
    const late = { type: 'task.upserted', entity: { ...mum, name: 'Call Mum', version: 3 }, version: 3, originClientId: null } as const;
    expect(applyTaskUpserted(ctx, late)).toBe('stale');
    expect(ids(queryClient, openKey)).toEqual(['Buy milk']);
  });
});
