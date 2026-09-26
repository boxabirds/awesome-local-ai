import { describe, expect, it, vi } from 'vitest';
import { EditGuard, type GuardFields, guardKeyFor } from '@/features/live/editGuard';
import { GoneError, NetworkError } from '@/lib/errors';
import { TASK_ID, WS_ID, taskDeleted, taskUpserted, workspaceUpdated } from '../../support/liveFixtures.ts';

const SELF = '5d2e8f1a-6b7c-4d9e-8f0a-1b2c3d4e5f60';
const KEY = `task:${TASK_ID}`;

type Fields = { name: string | null; description: string | null };

function setup(draft: Fields = { name: 'X', description: 'Two litres' }) {
  let now = 0;
  const fields = { current: draft };
  const save = vi.fn((_patch: Partial<Fields>) => Promise.resolve());
  const onGone = vi.fn();
  const guard = new EditGuard<Fields>({
    key: KEY,
    getFields: () => fields.current,
    save,
    onGone,
    now: () => now,
    clientId: SELF,
  });
  const at = (ms: number) => {
    now = ms;
  };
  return { guard, save, onGone, fields, at };
}

const otherChanged = () => taskUpserted({ name: 'Y', description: 'Two litres' });
const otherSame = () => taskUpserted({ name: 'X', description: 'Two litres' });
const otherDeleted = () => taskDeleted();
const ownEcho = () => taskUpserted({ name: 'Z', description: 'Two litres' }, SELF);

function conflicted() {
  const s = setup();
  s.guard.arm();
  s.guard.notify(otherChanged());
  expect(s.guard.getState()).toEqual({ kind: 'conflicted', mine: { name: 'X' }, theirs: { name: 'Y' }, editorOpen: true });
  return s;
}

describe('live.conflict_notice: guard x event (D6)', () => {
  it('guard keys', () => {
    expect(guardKeyFor(taskDeleted())).toBe(KEY);
    expect(guardKeyFor(workspaceUpdated(2, null))).toBe(`workspace:${WS_ID}`);
    expect(guardKeyFor({ type: 'tasks.bulk', entity: { ids: [] }, version: 1, originClientId: null })).toBeNull();
  });

  // Idle
  it.each([
    ['TC-G01 other upsert changed', otherChanged],
    ['TC-G02 other upsert same', otherSame],
    ['TC-G03 other deleted', otherDeleted],
    ['TC-G04 own echo', ownEcho],
  ])('Idle + %s -> no change, no callback', (_name, event) => {
    const { guard, onGone, save } = setup();
    const listener = vi.fn();
    guard.subscribe(listener);
    guard.notify(event());
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(listener).not.toHaveBeenCalled();
    expect(onGone).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  // Editing
  it('TC-G05 Editing draft X + other upsert name Y -> Conflicted {mine:{name:X}, theirs:{name:Y}}', () => {
    conflicted();
  });

  it('TC-G06 Editing + other upsert with the same values -> stays Editing', () => {
    const { guard } = setup();
    guard.arm();
    guard.notify(otherSame());
    expect(guard.getState()).toEqual({ kind: 'editing' });
  });

  it('TC-G07 Editing + other deleted -> gone callback, Idle', () => {
    const { guard, onGone } = setup();
    guard.arm();
    guard.notify(otherDeleted());
    expect(onGone).toHaveBeenCalledOnce();
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G08 Editing + own echo -> stays Editing', () => {
    const { guard } = setup();
    guard.arm();
    guard.notify(ownEcho());
    expect(guard.getState()).toEqual({ kind: 'editing' });
  });

  // RecentlySaved
  it('TC-G09 RecentlySaved at 9,999 ms (saved X) + other upsert Y -> Conflicted with mine X (editor closed)', () => {
    const { guard, at } = setup();
    guard.markSaved({ name: 'X', description: 'Two litres' });
    at(9_999);
    guard.notify(otherChanged());
    expect(guard.getState()).toEqual({ kind: 'conflicted', mine: { name: 'X' }, theirs: { name: 'Y' }, editorOpen: false });
  });

  it('TC-G10 RecentlySaved at 10,000 ms + other upsert Y -> Idle (window elapsed), no conflict', () => {
    const { guard, at } = setup();
    guard.markSaved({ name: 'X', description: 'Two litres' });
    at(10_000);
    guard.notify(otherChanged());
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G11 RecentlySaved + other deleted -> gone, Idle', () => {
    const { guard, onGone, at } = setup();
    guard.markSaved({ name: 'X', description: 'Two litres' });
    at(5_000);
    guard.notify(otherDeleted());
    expect(onGone).toHaveBeenCalledOnce();
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G12 RecentlySaved + own echo -> stays RecentlySaved', () => {
    const { guard } = setup();
    guard.markSaved({ name: 'X', description: 'Two litres' });
    guard.notify(ownEcho());
    expect(guard.getState()).toMatchObject({ kind: 'recentlySaved', saved: { name: 'X' } });
  });

  // Conflicted
  it('TC-G13 Conflicted mine X, theirs Y + other upsert Z -> theirs Z, mine X kept', () => {
    const { guard } = conflicted();
    guard.notify(taskUpserted({ name: 'Z', description: 'Two litres' }, undefined, 3));
    expect(guard.getState()).toEqual({ kind: 'conflicted', mine: { name: 'X' }, theirs: { name: 'Z' }, editorOpen: true });
  });

  it('TC-G14 Conflicted + other upsert with the same values as theirs -> unchanged (no notification)', () => {
    const { guard } = conflicted();
    const listener = vi.fn();
    guard.subscribe(listener);
    const before = guard.getState();
    guard.notify(otherChanged());
    expect(guard.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('TC-G15 Conflicted + other deleted -> gone, Idle, mine discarded', () => {
    const { guard, onGone } = conflicted();
    guard.notify(otherDeleted());
    expect(onGone).toHaveBeenCalledOnce();
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G16 Conflicted + own echo -> unchanged', () => {
    const { guard } = conflicted();
    const before = guard.getState();
    guard.notify(ownEcho());
    expect(guard.getState()).toBe(before);
  });
});

describe('live.conflict_notice: actions on Conflicted', () => {
  it('TC-G17 useMine: save called once with the changed field only ({name:X}); RecentlySaved', async () => {
    const { guard, save } = conflicted();
    expect(await guard.useMine()).toBeNull();
    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'X' });
    expect(guard.getState()).toMatchObject({ kind: 'recentlySaved', saved: { name: 'X' } });
  });

  it('TC-G18 keepTheirs -> Idle; save not called', () => {
    const { guard, save } = conflicted();
    guard.keepTheirs();
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(save).not.toHaveBeenCalled();
  });

  it('TC-G19 useMine, save rejects GoneError -> gone, Idle', async () => {
    const { guard, save, onGone } = conflicted();
    save.mockRejectedValueOnce(new GoneError());
    expect(await guard.useMine()).toBeInstanceOf(GoneError);
    expect(onGone).toHaveBeenCalledOnce();
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G20 useMine, save rejects NetworkError -> stays Conflicted, mine X kept, error returned', async () => {
    const { guard, save, onGone } = conflicted();
    save.mockRejectedValueOnce(new NetworkError());
    expect(await guard.useMine()).toBeInstanceOf(NetworkError);
    expect(guard.getState()).toEqual({ kind: 'conflicted', mine: { name: 'X' }, theirs: { name: 'Y' }, editorOpen: true });
    expect(onGone).not.toHaveBeenCalled();
  });

  it('TC-G21 disarm (editor closed) -> Idle (keep theirs)', () => {
    const { guard, save } = conflicted();
    guard.disarm();
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(save).not.toHaveBeenCalled();
  });

  it('a conflict that arrived after the editor closed becomes inline when the editor opens again', () => {
    const { guard } = setup();
    guard.markSaved({ name: 'X', description: 'Two litres' });
    guard.notify(otherChanged());
    guard.arm();
    expect(guard.getState()).toMatchObject({ kind: 'conflicted', editorOpen: true, mine: { name: 'X' } });
  });

  it('works for any string/null field set (generic over F)', () => {
    const guard = new EditGuard<GuardFields>({
      key: `workspace:${WS_ID}`,
      getFields: () => ({ name: 'Groceries 2' }),
      save: () => Promise.resolve(),
      onGone: () => {},
      clientId: SELF,
    });
    guard.arm();
    guard.notify(workspaceUpdated(3, null, 'Chores'));
    expect(guard.getState()).toEqual({ kind: 'conflicted', mine: { name: 'Groceries 2' }, theirs: { name: 'Chores' }, editorOpen: true });
  });
});
