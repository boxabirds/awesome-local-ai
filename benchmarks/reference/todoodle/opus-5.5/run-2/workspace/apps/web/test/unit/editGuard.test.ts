import { CONFLICT_RECENT_EDIT_WINDOW_MS } from '@todoodle/shared/limits';
import type { LiveEvent } from '@todoodle/shared/events';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { EditGuard, type GuardFields } from '@/features/live/editGuard';
import { GoneError, NetworkError } from '@/lib/errors';
import { SELF_CLIENT, TASK_ID, taskDeleted, taskUpserted } from '../live-helpers';

let now = 0;
let fields: GuardFields;
let onGone: Mock<() => void>;
let guard: EditGuard;
let changes: number;

const ORIGINAL = { title: 'Buy milk', description: 'Semi-skimmed' };

beforeEach(() => {
  now = 1_000_000;
  fields = { ...ORIGINAL };
  onGone = vi.fn();
  guard = new EditGuard({ key: `task:${TASK_ID}`, getFields: () => fields, onGone, now: () => now, clientId: SELF_CLIENT });
  changes = 0;
  guard.subscribe(() => changes++);
});

/** Editing: armed on the original values, then the user typed `title`. */
function editing(title = 'Buy oat milk') {
  guard.arm();
  fields = { ...fields, title };
}

/** RecentlySaved: our own save of `title` succeeded `ago` ms before now. */
function recentlySaved(title = 'Buy oat milk', ago = 0) {
  fields = { ...ORIGINAL, title };
  guard.markSaved(fields);
  now += ago;
}

function conflicted() {
  editing('Buy oat milk');
  guard.notify(taskUpserted({ ...ORIGINAL, title: 'Buy soy milk' }, 3));
  expect(guard.getState().kind).toBe('conflicted');
  changes = 0;
}

const otherChanged = () => taskUpserted({ ...ORIGINAL, title: 'Buy soy milk' }, 3);
const otherSame = (title = ORIGINAL.title) => taskUpserted({ ...ORIGINAL, title }, 3);
const ownEcho = () => taskUpserted({ ...ORIGINAL, title: 'Echo' }, 3, SELF_CLIENT);

describe('Idle', () => {
  it.each([
    ['TC-G01', 'other upsert changed', otherChanged],
    ['TC-G02', 'other upsert same', () => otherSame()],
    ['TC-G03', 'other deleted', () => taskDeleted(3)],
    ['TC-G04', 'own echo', ownEcho],
  ])('%s %s -> no change, no callback', (_ref, _label, event) => {
    guard.notify(event());
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(guard.getConflict()).toBeNull();
    expect(onGone).not.toHaveBeenCalled();
    expect(changes).toBe(0);
  });
});

describe('Editing', () => {
  it('TC-G05 draft X, other upsert name Y -> Conflicted {mine: X, theirs: Y} (changed fields only)', () => {
    editing('Buy oat milk');
    guard.notify(otherChanged());
    expect(guard.getConflict()).toEqual({ mine: { title: 'Buy oat milk' }, theirs: { title: 'Buy soy milk' } });
    expect(changes).toBe(1);
  });

  it('TC-G06 other upsert with the same values -> stays Editing', () => {
    editing('Buy oat milk');
    guard.notify(otherSame('Buy oat milk'));
    guard.notify(otherSame());
    expect(guard.getState().kind).toBe('editing');
    expect(guard.getConflict()).toBeNull();
  });

  it('a change to a field the user has not touched is not a conflict', () => {
    editing('Buy oat milk');
    guard.notify(taskUpserted({ title: ORIGINAL.title, description: 'Organic' }, 3));
    expect(guard.getState().kind).toBe('editing');
    expect(changes).toBe(0);
  });

  it('armed but nothing typed: another rename is not a conflict', () => {
    guard.arm();
    guard.notify(otherChanged());
    expect(guard.getState().kind).toBe('editing');
    expect(guard.getConflict()).toBeNull();
  });

  it('TC-G07 other deleted -> gone callback, Idle', () => {
    editing();
    guard.notify(taskDeleted(3));
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G08 own echo -> stays Editing', () => {
    editing();
    guard.notify(ownEcho());
    expect(guard.getState().kind).toBe('editing');
    expect(changes).toBe(0);
  });

  it('events about another entity are ignored', () => {
    editing();
    guard.notify({ ...otherChanged(), entity: { id: 'ffffffffffffffffffffffffffffffff', version: 3, title: 'Other' } } as LiveEvent);
    expect(guard.getState().kind).toBe('editing');
  });
});

describe('RecentlySaved', () => {
  it('TC-G09 at 9,999 ms after saving X, other upsert Y -> Conflicted with mine X', () => {
    recentlySaved('Buy oat milk', CONFLICT_RECENT_EDIT_WINDOW_MS - 1);
    guard.notify(otherChanged());
    expect(guard.getConflict()).toEqual({ mine: { title: 'Buy oat milk' }, theirs: { title: 'Buy soy milk' } });
    expect(guard.getState()).toMatchObject({ kind: 'conflicted', from: 'recentlySaved' });
  });

  it('TC-G10 at 10,000 ms -> Idle (window elapsed); no conflict', () => {
    recentlySaved('Buy oat milk', CONFLICT_RECENT_EDIT_WINDOW_MS);
    guard.notify(otherChanged());
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(guard.getConflict()).toBeNull();
  });

  it('TC-G11 other deleted -> gone, Idle', () => {
    recentlySaved();
    guard.notify(taskDeleted(3));
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G12 own echo -> stays RecentlySaved', () => {
    recentlySaved();
    guard.notify(ownEcho());
    expect(guard.getState().kind).toBe('recentlySaved');
  });
});

describe('Conflicted', () => {
  it('TC-G13 mine X, theirs Y; other upsert Z -> mine X, theirs Z', () => {
    conflicted();
    guard.notify(taskUpserted({ ...ORIGINAL, title: 'Buy almond milk' }, 4));
    expect(guard.getConflict()).toEqual({ mine: { title: 'Buy oat milk' }, theirs: { title: 'Buy almond milk' } });
    expect(changes).toBe(1);
  });

  it('TC-G14 other upsert with the same values as theirs -> unchanged', () => {
    conflicted();
    const before = guard.getConflict();
    guard.notify(taskUpserted({ ...ORIGINAL, title: 'Buy soy milk' }, 4));
    expect(guard.getConflict()).toBe(before);
    expect(changes).toBe(0);
  });

  it('TC-G15 other deleted -> gone, Idle, mine discarded', () => {
    conflicted();
    guard.notify(taskDeleted(4));
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(guard.getConflict()).toBeNull();
  });

  it('TC-G16 own echo -> unchanged', () => {
    conflicted();
    guard.notify(ownEcho());
    expect(guard.getState().kind).toBe('conflicted');
    expect(changes).toBe(0);
  });

  it('TC-G17 useMine with mine {title: X} (description unchanged): save called once with {title: X} only; RecentlySaved', async () => {
    conflicted();
    const save = vi.fn(async () => {});
    expect(await guard.useMine(save)).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: 'Buy oat milk' });
    expect(guard.getState()).toMatchObject({ kind: 'recentlySaved', saved: { title: 'Buy oat milk' } });
    expect(guard.getConflict()).toBeNull();
  });

  it('TC-G18 keepTheirs -> Idle; save not called', () => {
    conflicted();
    const save = vi.fn(async () => {});
    guard.keepTheirs();
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(save).not.toHaveBeenCalled();
  });

  it('TC-G19 useMine, save rejects GoneError -> gone, Idle', async () => {
    conflicted();
    const error = await guard.useMine(async () => {
      throw new GoneError();
    });
    expect(error).toBeInstanceOf(GoneError);
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(guard.getState()).toEqual({ kind: 'idle' });
  });

  it('TC-G20 useMine, save rejects NetworkError -> stays Conflicted, mine X kept, error returned', async () => {
    conflicted();
    const failure = new NetworkError();
    expect(await guard.useMine(async () => Promise.reject(failure))).toBe(failure);
    expect(guard.getState().kind).toBe('conflicted');
    expect(guard.getConflict()?.mine).toEqual({ title: 'Buy oat milk' });
    expect(onGone).not.toHaveBeenCalled();
  });

  it('TC-G21 disarm (editor closed) -> Idle (keep theirs)', () => {
    conflicted();
    guard.disarm();
    expect(guard.getState()).toEqual({ kind: 'idle' });
    expect(guard.getConflict()).toBeNull();
  });
});
