import type { Task } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  completeInCache,
  insertBySortOrder,
  placeTask,
  removeFromCache,
  reopenInCache,
  updateInCache,
} from '@/features/tasks/cacheOps';
import type { LocalTask } from '@/features/tasks/localTask';
import { task } from '../../msw/tasks';

const DONE_AT = '2026-09-27T09:15:00.000Z';

// Realistic names, typed with the shared Task type (fixtures parse through TaskSchema).
function openList(): Task[] {
  return [
    task({ name: 'Buy milk', sortOrder: 1 }),
    task({ name: 'Email Sam re: invoice #4411', description: 'Attach the PDF\nand the receipt', sortOrder: 2 }),
    task({ name: 'Call Mum 📞', sortOrder: 3.5 }),
    task({ name: 'שלום — call Dana', sortOrder: 4 }),
  ];
}

function withCompleted(): Task[] {
  return [
    ...openList(),
    task({ name: 'Renew passport', sortOrder: 0.5, completedAt: '2026-09-26T07:45:00.000Z' }),
    task({ name: 'Pay council tax', sortOrder: 9, completedAt: '2026-09-24T18:02:00.000Z' }),
  ];
}

describe('TC-U08 cache ops', () => {
  it('completeInCache drops the task from an open-only list and keeps the other references', () => {
    const list = openList();
    const next = completeInCache(list, list[1]!.id, DONE_AT, false);
    expect(next.map((t) => t.name)).toEqual(['Buy milk', 'Call Mum 📞', 'שלום — call Dana']);
    expect(next[0]).toBe(list[0]);
    expect(list).toHaveLength(4);
  });

  it('completeInCache moves the task to the top of the completed group in a list with completed tasks', () => {
    const list = withCompleted();
    const next = completeInCache(list, list[0]!.id, DONE_AT, true);
    expect(next.map((t) => t.name)).toEqual([
      'Email Sam re: invoice #4411',
      'Call Mum 📞',
      'שלום — call Dana',
      'Buy milk',
      'Renew passport',
      'Pay council tax',
    ]);
    expect(next[3]!.completedAt).toBe(DONE_AT);
  });

  it('reopenInCache returns the task to its sortOrder position (open-only: inserted; with completed: moved)', () => {
    const list = openList();
    const milk = list[0]!;
    const without = completeInCache(list, milk.id, DONE_AT, false);
    const back = reopenInCache(without, { ...milk, completedAt: DONE_AT }, false);
    expect(back.map((t) => t.id)).toEqual(list.map((t) => t.id));

    const full = withCompleted();
    const passport = full[4]!;
    const reopened = reopenInCache(full, passport, true);
    // sortOrder 0.5: the first open task.
    expect(reopened.map((t) => t.name).slice(0, 2)).toEqual(['Renew passport', 'Buy milk']);
    expect(reopened[0]!.completedAt).toBeNull();
  });

  it('insertBySortOrder uses the id index: a new id lands at its sortOrder index, a known id is replaced', () => {
    const list = openList();
    const between = task({ name: 'Water the plants 🌿', sortOrder: 2.5 });
    const next = insertBySortOrder(list, between);
    expect(next.map((t) => t.name)).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Water the plants 🌿', 'Call Mum 📞', 'שלום — call Dana']);
    const renamed = { ...list[2]!, name: 'Call Mum 📞 (Sunday)', version: 2 };
    const replaced = insertBySortOrder(list, renamed);
    expect(replaced).toHaveLength(4);
    expect(replaced[2]).toBe(renamed);
    // Open tasks go before the completed group even with a larger sortOrder.
    const full = withCompleted();
    const late = task({ name: 'Fix the bike light', sortOrder: 20 });
    expect(insertBySortOrder(full, late).map((t) => t.name).indexOf('Fix the bike light')).toBe(4);
  });

  it('updateInCache changes fields in place; an unchanged patch returns the same list', () => {
    const list = openList();
    const next = updateInCache(list, list[0]!.id, { name: 'Buy oat milk', description: '1 litre' });
    expect(next[0]).toMatchObject({ name: 'Buy oat milk', description: '1 litre' });
    expect(next[1]).toBe(list[1]);
    expect(updateInCache(list, list[0]!.id, { name: 'Buy milk' })).toBe(list);
  });

  it('removeFromCache removes by id; unknown ids and undefined lists are left alone', () => {
    const list = openList();
    expect(removeFromCache(list, list[3]!.id).map((t) => t.name)).toEqual(['Buy milk', 'Email Sam re: invoice #4411', 'Call Mum 📞']);
    expect(removeFromCache(list, 'f'.repeat(32))).toBe(list);
    expect(removeFromCache(undefined, list[0]!.id)).toBeUndefined();
  });

  it('placeTask in the same position replaces in place; completed in an open-only list is dropped', () => {
    const list = openList();
    const edited = { ...list[1]!, name: 'Email Sam', version: 2 };
    const next = placeTask(list, edited, false);
    expect(next.map((t) => t.id)).toEqual(list.map((t) => t.id));
    expect(next[1]).toBe(edited);
    expect(placeTask(list, { ...list[1]!, completedAt: DONE_AT }, false)).toHaveLength(3);
  });

  it('rollback: restoring the snapshot deep-equals the cache before the change', () => {
    const snapshot: LocalTask[] = withCompleted();
    const copy = structuredClone(snapshot);
    let cache: LocalTask[] = snapshot;
    cache = completeInCache(cache, cache[0]!.id, DONE_AT, true);
    cache = removeFromCache(cache, cache[1]!.id);
    cache = updateInCache(cache, cache[0]!.id, { name: 'Changed' });
    expect(cache).not.toEqual(copy);
    // The ops never mutated the snapshot, so restoring it is exact.
    cache = snapshot;
    expect(cache).toEqual(copy);
  });
});
