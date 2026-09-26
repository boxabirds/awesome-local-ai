import { QueryClient } from '@tanstack/react-query';
import type { Workspace } from '@todoodle/shared/schemas';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DispatchDeps, dispatchEvent } from '@/features/live/dispatch';
import { registerWorkspaceHandlers } from '@/features/live/handlers';
import { type HandlerCtx, clearLiveHandlersForTests, registerLiveHandler } from '@/features/live/registry';
import { queryKeys } from '@/lib/queryKeys';
import { OTHER_CLIENT, TASK_ID, WS_ID, taskUpserted, workspaceAt, workspaceUpdated } from '../../support/liveFixtures.ts';

const SELF = '5d2e8f1a-6b7c-4d9e-8f0a-1b2c3d4e5f60';
const KEY = queryKeys.workspace(WS_ID);

let ctx: HandlerCtx;
let deps: DispatchDeps & { announcer: { record: Mock<() => void> }; notifyGuards: Mock<DispatchDeps['notifyGuards']> };

beforeEach(() => {
  ctx = { queryClient: new QueryClient(), workspaceId: WS_ID };
  deps = { clientId: SELF, announcer: { record: vi.fn<() => void>() }, notifyGuards: vi.fn<DispatchDeps['notifyGuards']>() };
  registerWorkspaceHandlers();
});
afterEach(() => clearLiveHandlersForTests());

function cached(): Workspace | undefined {
  return ctx.queryClient.getQueryData<Workspace>(KEY);
}

describe('live.client_sync: dispatchEvent (D3 origin x version)', () => {
  it('TC-C01 cache v2 + other-origin v3 -> cache v3 with the new name', () => {
    ctx.queryClient.setQueryData(KEY, workspaceAt(2, 'Groceries'));
    expect(dispatchEvent(ctx, workspaceUpdated(3, OTHER_CLIENT, 'Groceries 2'), deps)).toBe('applied');
    expect(cached()).toEqual(workspaceAt(3, 'Groceries 2'));
    expect(deps.notifyGuards).toHaveBeenCalledOnce();
    expect(deps.announcer.record).toHaveBeenCalledOnce();
  });

  it('TC-C02 cache v3 + other-origin v3 -> unchanged', () => {
    ctx.queryClient.setQueryData(KEY, workspaceAt(3, 'Groceries'));
    expect(dispatchEvent(ctx, workspaceUpdated(3, OTHER_CLIENT, 'Other'), deps)).toBe('stale');
    expect(cached()).toEqual(workspaceAt(3, 'Groceries'));
  });

  it('TC-C03 cache v3 + other-origin v2 (stale) -> unchanged', () => {
    ctx.queryClient.setQueryData(KEY, workspaceAt(3, 'Groceries'));
    expect(dispatchEvent(ctx, workspaceUpdated(2, OTHER_CLIENT, 'Old'), deps)).toBe('stale');
    expect(cached()).toEqual(workspaceAt(3, 'Groceries'));
    expect(deps.announcer.record).not.toHaveBeenCalled();
  });

  it('TC-C04 self-origin v1, v2 and v3 -> unchanged; guard and announcer not called', () => {
    ctx.queryClient.setQueryData(KEY, workspaceAt(2, 'Groceries'));
    for (const version of [1, 2, 3]) expect(dispatchEvent(ctx, workspaceUpdated(version, SELF), deps)).toBe('echo');
    expect(cached()).toEqual(workspaceAt(2, 'Groceries'));
    expect(deps.notifyGuards).not.toHaveBeenCalled();
    expect(deps.announcer.record).not.toHaveBeenCalled();
  });

  it('TC-C05 null-origin v3 / v2 / v1 against cache v2 -> applied / ignored / ignored', () => {
    ctx.queryClient.setQueryData(KEY, workspaceAt(2, 'Groceries'));
    expect(dispatchEvent(ctx, workspaceUpdated(3, null, 'Null v3'), deps)).toBe('applied');
    expect(cached()?.name).toBe('Null v3');
    ctx.queryClient.setQueryData(KEY, workspaceAt(2, 'Groceries'));
    expect(dispatchEvent(ctx, workspaceUpdated(2, null), deps)).toBe('stale');
    expect(dispatchEvent(ctx, workspaceUpdated(1, null), deps)).toBe('stale');
    expect(cached()).toEqual(workspaceAt(2, 'Groceries'));
  });

  it('TC-C06 empty cache + other-origin v1 -> cache set', () => {
    expect(cached()).toBeUndefined();
    expect(dispatchEvent(ctx, workspaceUpdated(1, OTHER_CLIENT, 'Fresh'), deps)).toBe('applied');
    expect(cached()).toEqual(workspaceAt(1, 'Fresh'));
  });

  it('TC-C07 a type with no handlers invalidates [ws, id] exactly once', () => {
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    expect(dispatchEvent(ctx, taskUpserted({ title: 'Milk' }), deps)).toBe('invalidated');
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['ws', WS_ID] });
    expect(deps.announcer.record).not.toHaveBeenCalled();
  });

  it('TC-C08 a malformed frame is ignored with a warning and never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    for (const frame of ['not json', { type: 'workspace.updated' }, { type: 'nope', version: 1 }, null]) {
      expect(() => dispatchEvent(ctx, frame, deps)).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(4);
    expect(invalidate).not.toHaveBeenCalled();
    expect(deps.notifyGuards).not.toHaveBeenCalled();
  });

  it('tasks.bulk refetches tasks and counts', () => {
    const invalidate = vi.spyOn(ctx.queryClient, 'invalidateQueries');
    dispatchEvent(ctx, { type: 'tasks.bulk', entity: { ids: [TASK_ID] }, version: 4, originClientId: OTHER_CLIENT }, deps);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([queryKeys.tasks(WS_ID), queryKeys.counts(WS_ID)]);
  });
});

describe('live.client_sync: registry', () => {
  it('TC-C11 Set semantics: h1 registered twice runs once; unregistering h1 leaves only h2', () => {
    const h1 = vi.fn(() => true);
    const h2 = vi.fn(() => true);
    const unregisterH1 = registerLiveHandler('task.upserted', h1);
    registerLiveHandler('task.upserted', h1);
    registerLiveHandler('task.upserted', h2);

    dispatchEvent(ctx, taskUpserted({ title: 'Milk' }), deps);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);

    unregisterH1();
    dispatchEvent(ctx, taskUpserted({ title: 'Milk' }, OTHER_CLIENT, 3), deps);
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(2);
  });

  it('an event is applied when any one handler applies it (the others may say stale)', () => {
    registerLiveHandler('task.upserted', () => false);
    registerLiveHandler('task.upserted', () => true);
    expect(dispatchEvent(ctx, taskUpserted({ title: 'Milk' }), deps)).toBe('applied');
  });
});

describe('live.client_sync: announcer is only told about applied other-origin events', () => {
  it('TC-C16 own echo, stale and malformed events record nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ctx.queryClient.setQueryData(KEY, workspaceAt(3));
    dispatchEvent(ctx, workspaceUpdated(4, SELF), deps);
    dispatchEvent(ctx, workspaceUpdated(2, OTHER_CLIENT), deps);
    dispatchEvent(ctx, '{broken', deps);
    expect(deps.announcer.record).not.toHaveBeenCalled();
  });
});
