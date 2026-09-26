import type { Task } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  completeInCache,
  finishLeaving,
  insertBySortOrder,
  placeTask,
  removeFromCache,
  reopenInCache,
  rollbackTask,
  updateInCache,
} from '@/features/tasks/cacheOps';
import type { LocalTask } from '@/features/tasks/taskCache';
import { makeTask } from '../../msw/tasks.ts';

// Story 6, TC-U08: the pure cache operations behind optimistic complete/reopen/edit/delete/restore.

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const OPEN = { includeCompleted: false };
const ALL = { includeCompleted: true };
const DONE_AT = '2026-09-26T09:00:00.000Z';

const A = makeTask({ name: 'Buy milk' }, 0);
const B = makeTask({ name: 'Email Sam re: invoice #4411' }, 1);
const C = makeTask({ name: 'Call Mum 📞' }, 2);
const D = makeTask({ name: 'שלום — call the landlord' }, 3);
const X = makeTask({ name: 'Book dentist — ask about Tuesday', completedAt: '2026-09-24T10:00:00.000Z' }, 7);
const Y = makeTask({ name: 'Water the plants', completedAt: '2026-09-20T10:00:00.000Z' }, 5);

const names = (list: LocalTask[] | undefined) => list?.map((t) => t.name);

describe('TC-U08 cache ops', () => {
  it('completeInCache with leaving keeps the row ticked in place; finishLeaving then removes it (open-only list)', () => {
    const list = deepFreeze([A, B, C]);
    const leaving = completeInCache(list, B.id, DONE_AT, { ...OPEN, leaving: true })!;
    expect(names(leaving)).toEqual(names(list));
    expect(leaving[1]).toMatchObject({ id: B.id, completedAt: DONE_AT, leaving: true });
    expect(leaving[0]).toBe(A);
    expect(leaving[2]).toBe(C);
    const settled = finishLeaving(leaving, B.id, OPEN)!;
    expect(names(settled)).toEqual([A.name, C.name]);
  });

  it('completeInCache without leaving (reduced motion) moves the task at once; with completed shown it heads the completed group', () => {
    const list = deepFreeze([A, B, C, X, Y]);
    expect(names(completeInCache(list, B.id, DONE_AT, { ...OPEN, leaving: false }))).toEqual([A.name, C.name, X.name, Y.name]);
    const all = completeInCache(list, B.id, DONE_AT, { ...ALL, leaving: false })!;
    expect(names(all)).toEqual([A.name, C.name, B.name, X.name, Y.name]);
    expect(all[2]).toMatchObject({ completedAt: DONE_AT });
    expect(all[2]).not.toHaveProperty('leaving');
  });

  it('finishLeaving with completed shown moves the task into the completed group', () => {
    const list = deepFreeze([A, B, C, X]);
    const leaving = completeInCache(list, A.id, DONE_AT, { ...ALL, leaving: true });
    expect(names(finishLeaving(leaving, A.id, ALL))).toEqual([B.name, C.name, A.name, X.name]);
  });

  it('completing a missing or already completed task returns the same array', () => {
    const list = deepFreeze([A, X]);
    expect(completeInCache(list, 'nope', DONE_AT, { ...ALL, leaving: true })).toBe(list);
    expect(completeInCache(list, X.id, DONE_AT, { ...ALL, leaving: true })).toBe(list);
  });

  it('reopenInCache returns the task to its original index (by sortOrder), from the completed group', () => {
    const list = deepFreeze([A, C, D, X, Y]);
    const reopenedB = { ...B, completedAt: DONE_AT };
    const withB = deepFreeze([A, C, D, reopenedB as Task, X, Y]);
    expect(names(reopenInCache(withB, reopenedB, ALL))).toEqual([A.name, B.name, C.name, D.name, X.name, Y.name]);
    // Open-only list (B was not in it): inserted at its sortOrder.
    expect(names(reopenInCache(deepFreeze([A, C, D]), reopenedB, OPEN))).toEqual([A.name, B.name, C.name, D.name]);
    expect(list).toHaveLength(5);
  });

  it('insertBySortOrder uses the sortOrder index and only searches the open group', () => {
    const list = deepFreeze([A, C, D, X, Y]);
    const next = insertBySortOrder(list, B);
    expect(names(next)).toEqual([A.name, B.name, C.name, D.name, X.name, Y.name]);
    expect(next.indexOf(B)).toBe(1);
    const last = makeTask({ name: 'Renew passport' }, 50);
    expect(insertBySortOrder(list, last).indexOf(last)).toBe(3);
    const first = makeTask({ name: 'Pay council tax', sortOrder: 0.5 });
    expect(insertBySortOrder(list, first).indexOf(first)).toBe(0);
    expect(insertBySortOrder(undefined, B)).toEqual([B]);
  });

  it('placeTask puts a completed task in the completed group by completedAt desc, and nowhere in open-only lists', () => {
    const list = deepFreeze([A, X, Y]);
    const Z = makeTask({ name: 'Renew passport', completedAt: '2026-09-22T10:00:00.000Z' }, 9);
    expect(names(placeTask(list, Z, ALL))).toEqual([A.name, X.name, Z.name, Y.name]);
    expect(placeTask(deepFreeze([A, B]), Z, OPEN)).toEqual([A, B]);
  });

  it('removeFromCache removes one task, and returns the same array when it is absent', () => {
    const list = deepFreeze([A, B, C]);
    expect(names(removeFromCache(list, B.id))).toEqual([A.name, C.name]);
    expect(removeFromCache(list, 'nope')).toBe(list);
    expect(removeFromCache(undefined, B.id)).toBeUndefined();
  });

  it('updateInCache replaces in place, keeping untouched references', () => {
    const list = deepFreeze([A, B, C]);
    const renamed = { ...B, name: 'Email Sam re: invoice #4412', version: 2 };
    const next = updateInCache(list, renamed, OPEN)!;
    expect(next[1]).toEqual(renamed);
    expect(next[0]).toBe(A);
    expect(next[2]).toBe(C);
    expect(updateInCache(list, makeTask({ name: 'elsewhere' }), OPEN)).toBe(list);
  });

  it('updateInCache keeps a leaving row leaving (the server copy arrives during the animation)', () => {
    const leaving = completeInCache(deepFreeze([A, B]), A.id, DONE_AT, { ...OPEN, leaving: true })!;
    const server = { ...A, completedAt: '2026-09-26T09:00:00.123Z', version: 2 };
    const next = updateInCache(leaving, server, OPEN)!;
    expect(next[0]).toMatchObject({ id: A.id, leaving: true, version: 2, completedAt: server.completedAt });
  });

  it.each([
    ['complete (leaving)', (l: LocalTask[]) => completeInCache(l, B.id, DONE_AT, { ...OPEN, leaving: true })],
    ['complete then leave', (l: LocalTask[]) => finishLeaving(completeInCache(l, B.id, DONE_AT, { ...OPEN, leaving: true }), B.id, OPEN)],
    ['remove', (l: LocalTask[]) => removeFromCache(l, B.id)],
    ['edit', (l: LocalTask[]) => updateInCache(l, { ...B, name: 'Renamed' }, OPEN)],
  ])('rollback after %s deep-equals the snapshot (same index)', (_label, op) => {
    const snapshot = deepFreeze([A, B, C, D]);
    const changed = op(snapshot);
    expect(changed).not.toEqual(snapshot);
    expect(rollbackTask(changed, snapshot, B.id)).toEqual(snapshot);
  });

  it('rollback of one task keeps a concurrent change to another task', () => {
    const snapshot = deepFreeze([A, B, C, D]);
    const afterBoth = removeFromCache(removeFromCache(snapshot, B.id), D.id);
    expect(names(rollbackTask(afterBoth, snapshot, B.id))).toEqual([A.name, B.name, C.name]);
    expect(names(rollbackTask(removeFromCache(snapshot, A.id), snapshot, A.id))).toEqual(names(snapshot));
  });

  it('rollback of a task the snapshot did not have removes it (a reopen into the open list)', () => {
    const snapshot = deepFreeze([A, C]);
    const reopened = reopenInCache(snapshot, { ...B, completedAt: DONE_AT }, OPEN);
    expect(rollbackTask(reopened, snapshot, B.id)).toEqual(snapshot);
  });
});
