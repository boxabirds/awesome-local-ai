import type { LiveEvent } from '@todoodle/shared/events';
import type { Workspace } from '@todoodle/shared/schemas';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createAnnouncer } from '@/features/live/announcer';
import { dispatchEvent, type DispatchCtx } from '@/features/live/dispatch';
import { registerWorkspaceHandlers } from '@/features/live/handlers';
import { registerLiveHandler } from '@/features/live/registry';
import { queryKeys } from '@/lib/queryKeys';
import { workspace } from '../fixtures';
import { OTHER_CLIENT, renameEvent, SELF_CLIENT, taskUpserted, WS_ID } from '../live-helpers';

let queryClient: QueryClient;
let unregister: () => void;
let ctx: DispatchCtx & { editGuard: { notify: Mock<(e: LiveEvent) => void> }; announcer: { record: Mock<(e: LiveEvent) => void> } };

const cached = () => queryClient.getQueryData<Workspace>(queryKeys.workspace(WS_ID));

beforeEach(() => {
  queryClient = new QueryClient();
  unregister = registerWorkspaceHandlers();
  ctx = {
    queryClient,
    workspaceId: WS_ID,
    clientId: SELF_CLIENT,
    editGuard: { notify: vi.fn() },
    announcer: { record: vi.fn() },
  };
});
afterEach(() => unregister());

function seed(version: number, name = 'My Todoodle') {
  queryClient.setQueryData(queryKeys.workspace(WS_ID), workspace({ name, version }));
}

describe('dispatchEvent: workspace.updated into the cache', () => {
  it('TC-C01 cache v2, other-origin v3 -> cache v3 with the new name; guard and announcer told', () => {
    seed(2);
    expect(dispatchEvent(ctx, renameEvent('Groceries', 3))).toBe('applied');
    expect(cached()).toMatchObject({ name: 'Groceries', version: 3 });
    expect(ctx.editGuard.notify).toHaveBeenCalledTimes(1);
    expect(ctx.announcer.record).toHaveBeenCalledTimes(1);
  });

  it('TC-C02 cache v3, other-origin v3 -> unchanged', () => {
    seed(3, 'Mine');
    expect(dispatchEvent(ctx, renameEvent('Theirs', 3))).toBe('stale');
    expect(cached()).toMatchObject({ name: 'Mine', version: 3 });
    expect(ctx.announcer.record).not.toHaveBeenCalled();
  });

  it('TC-C03 cache v3, other-origin v2 -> unchanged (stale)', () => {
    seed(3, 'Mine');
    expect(dispatchEvent(ctx, renameEvent('Older', 2))).toBe('stale');
    expect(cached()).toMatchObject({ name: 'Mine', version: 3 });
  });

  it('TC-C04 cache v2, self-origin v1/v2/v3 -> unchanged; guard and announcer not called', () => {
    seed(2, 'Mine');
    for (const v of [1, 2, 3]) expect(dispatchEvent(ctx, renameEvent(`Echo ${v}`, v, SELF_CLIENT))).toBe('echo');
    expect(cached()).toMatchObject({ name: 'Mine', version: 2 });
    expect(ctx.editGuard.notify).not.toHaveBeenCalled();
    expect(ctx.announcer.record).not.toHaveBeenCalled();
  });

  it('TC-C05 cache v2, null-origin v3 / v2 / v1 -> applied / ignored / ignored', () => {
    seed(2);
    expect(dispatchEvent(ctx, renameEvent('Three', 3, null))).toBe('applied');
    expect(dispatchEvent(ctx, renameEvent('Two', 2, null))).toBe('stale');
    expect(dispatchEvent(ctx, renameEvent('One', 1, null))).toBe('stale');
    expect(cached()).toMatchObject({ name: 'Three', version: 3 });
  });

  it('TC-C06 empty cache, other-origin v1 -> cache set', () => {
    expect(cached()).toBeUndefined();
    expect(dispatchEvent(ctx, renameEvent('Fresh ✨', 1))).toBe('applied');
    expect(cached()).toMatchObject({ id: WS_ID, name: 'Fresh ✨', version: 1 });
  });

  it('TC-C07 a type with no handler -> invalidateQueries({queryKey: [ws, id]}) once', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    expect(dispatchEvent(ctx, taskUpserted({ title: 'Buy milk' }, 2))).toBe('invalidated');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['ws', WS_ID] });
    expect(ctx.announcer.record).not.toHaveBeenCalled();
  });

  it.each([
    ['not an object', 'hello'],
    ['unknown type', { ...renameEvent('X', 3), type: 'workspace.renamed' }],
    ['no version', { type: 'workspace.updated', entity: workspace(), originClientId: OTHER_CLIENT }],
    ['null', null],
  ])('TC-C08 malformed frame (%s) -> ignored with a warning, no throw', (_label, frame) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed(2, 'Mine');
    expect(() => dispatchEvent(ctx, frame)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(cached()).toMatchObject({ name: 'Mine', version: 2 });
  });

  it('tasks.bulk invalidates the task and count queries', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    dispatchEvent(ctx, { type: 'tasks.bulk', entity: { ids: ['a1b2c3d4e5f60718293a4b5c6d7e8f90'] }, version: 4, originClientId: OTHER_CLIENT });
    expect(invalidate.mock.calls.map((c) => c[0])).toEqual([{ queryKey: ['ws', WS_ID, 'tasks'] }, { queryKey: ['ws', WS_ID, 'counts'] }]);
  });
});

describe('registerLiveHandler', () => {
  it('TC-C11 Set semantics: h1 registered twice runs once; unregistering h1 leaves h2', () => {
    const h1 = vi.fn(() => 'applied' as const);
    const h2 = vi.fn(() => 'stale' as const);
    const off1 = registerLiveHandler('task.upserted', h1);
    registerLiveHandler('task.upserted', h1);
    const off2 = registerLiveHandler('task.upserted', h2);
    dispatchEvent(ctx, taskUpserted({ title: 'A' }, 2));
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    off1();
    dispatchEvent(ctx, taskUpserted({ title: 'B' }, 3));
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(2);
    off2();
  });
});

describe('announcer', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: 1_000_000 }));

  const clock = {
    now: () => Date.now(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };

  it('TC-C14 idle for 10,000 ms or more: one applied event is announced immediately', () => {
    const announcer = createAnnouncer(clock);
    const seen: string[] = [];
    announcer.subscribe(() => seen.push(announcer.getSnapshot().message));
    announcer.record();
    expect(seen).toEqual(['1 change made by someone else']);
    // Another 10,000 ms of quiet: leading edge again.
    vi.advanceTimersByTime(10_000);
    announcer.record();
    expect(seen).toEqual(['1 change made by someone else', '1 change made by someone else']);
    expect(announcer.getSnapshot().seq).toBe(2);
  });

  it('TC-C15 last announcement at t=0; events at 1, 2, 3 s -> nothing at 9,999 ms, "3 changes" at 10,000 ms, count reset', () => {
    const announcer = createAnnouncer(clock);
    const seen: string[] = [];
    announcer.record(); // t=0: leading edge
    announcer.subscribe(() => seen.push(announcer.getSnapshot().message));
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1_000);
      announcer.record();
    }
    vi.advanceTimersByTime(9_999 - 3_000);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['3 changes made by someone else']);
    // Count reset: nothing more without new events.
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(1);
  });

  it('an event exactly 10,000 ms after the last announcement is announced at once; 9,999 ms is deferred', () => {
    const announcer = createAnnouncer(clock);
    announcer.record();
    vi.advanceTimersByTime(9_999);
    announcer.record();
    expect(announcer.getSnapshot().seq).toBe(1);
    vi.advanceTimersByTime(1);
    expect(announcer.getSnapshot()).toEqual({ message: '1 change made by someone else', seq: 2 });
    vi.advanceTimersByTime(10_000);
    announcer.record();
    expect(announcer.getSnapshot().seq).toBe(3);
  });

  it('TC-C16 own-echo, stale and malformed events record and announce nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const announcer = createAnnouncer(clock);
    const record = vi.spyOn(announcer, 'record');
    const real: DispatchCtx = { queryClient, workspaceId: WS_ID, clientId: SELF_CLIENT, announcer };
    seed(5);
    dispatchEvent(real, renameEvent('Echo', 6, SELF_CLIENT));
    dispatchEvent(real, renameEvent('Stale', 4));
    dispatchEvent(real, { nope: true });
    vi.advanceTimersByTime(60_000);
    expect(record).not.toHaveBeenCalled();
    expect(announcer.getSnapshot()).toEqual({ message: '', seq: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
