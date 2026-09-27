import type { Task } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import type { LocalTask } from '@/features/tasks/localTask';
import {
  adjustCount,
  appendOptimistic,
  applyTaskEvents,
  markStatus,
  mergeLocalRows,
  nextSortOrder,
  removeLocal,
  replaceWithServer,
} from '@/features/tasks/taskCache';
import { task, taskId } from '../../msw/tasks';

const pending = (overrides: Partial<LocalTask> = {}): LocalTask => ({
  ...task({ name: 'Buy milk', version: 0, sortOrder: 2 }),
  localStatus: 'pending',
  ...overrides,
});

describe('taskCache', () => {
  it('TC-60 appendOptimistic adds the pending task at the end without mutating the input', () => {
    const a = task({ name: 'A', sortOrder: 1 });
    const list = [a];
    const p = pending();
    const next = appendOptimistic(list, p);
    expect(next).toEqual([a, p]);
    expect(next[0]).toBe(a);
    expect(list).toEqual([a]);
    expect(appendOptimistic(undefined, p)).toEqual([p]);
  });

  it('nextSortOrder is one step past the largest, 1 for an empty list', () => {
    expect(nextSortOrder(undefined)).toBe(1);
    expect(nextSortOrder([task({ sortOrder: 3 }), task({ sortOrder: 7 })])).toBe(8);
  });

  it('TC-61 markStatus failed keeps name and description', () => {
    const p = pending({ description: 'semi-skimmed' });
    const [failed] = markStatus([p], p.id, 'failed');
    expect(failed).toMatchObject({ localStatus: 'failed', name: 'Buy milk', description: 'semi-skimmed' });
    expect(p.localStatus).toBe('pending');
  });

  it('markStatus returns the same list when the id is unknown or the status is unchanged', () => {
    const list = [pending()];
    expect(markStatus(list, taskId(), 'failed')).toBe(list);
    expect(markStatus(list, list[0]!.id, 'pending')).toBe(list);
  });

  it('TC-62 replaceWithServer swaps the pending task in place for the server task (no local status)', () => {
    const a = task({ name: 'A', sortOrder: 1 });
    const p = pending();
    const b = task({ name: 'B', sortOrder: 3 });
    const server: Task = { ...p, version: 1, createdAt: '2026-09-27 10:01:00', updatedAt: '2026-09-27 10:01:00' };
    delete (server as LocalTask).localStatus;
    const next = replaceWithServer([a, p, b], server);
    expect(next.map((t) => t.id)).toEqual([a.id, p.id, b.id]);
    expect(next[1]).toBe(server);
    expect(next[1]).not.toHaveProperty('localStatus');
    expect(next[0]).toBe(a);
    expect(next[2]).toBe(b);
  });

  it('TC-63 removeLocal drops the task and keeps the other references', () => {
    const a = task({ name: 'A' });
    const p = pending();
    const next = removeLocal([a, p], p.id);
    expect(next).toEqual([a]);
    expect(next[0]).toBe(a);
  });

  it('adjustCount changes inbox, never below zero, keeps other fields', () => {
    expect(adjustCount({ inbox: 3 }, 1)).toEqual({ inbox: 4 });
    expect(adjustCount({ inbox: 0 }, -1)).toEqual({ inbox: 0 });
    expect(adjustCount({ inbox: 2, today: 5 } as never, -1)).toEqual({ inbox: 1, today: 5 });
    expect(adjustCount(undefined, 1)).toBeUndefined();
  });

  it('TC-64 applyTaskEvents: newer replaces, equal/older ignored, new id inserted at its sortOrder', () => {
    const a = task({ name: 'A', sortOrder: 1 });
    const cached = task({ name: 'Old', sortOrder: 2, version: 2 });
    const c = task({ name: 'C', sortOrder: 4 });
    const list = [a, cached, c];

    const newer = applyTaskEvents(list, [{ entity: { ...cached, name: 'New' }, version: 3 }]);
    expect(newer[1]).toMatchObject({ name: 'New', version: 3 });
    expect(newer[0]).toBe(a);

    expect(applyTaskEvents(newer, [{ entity: { ...cached, name: 'Stale' }, version: 2 }])).toBe(newer);
    expect(applyTaskEvents(newer, [{ entity: { ...cached, name: 'Same' }, version: 3 }])).toBe(newer);

    const inserted = task({ name: 'B', sortOrder: 3 });
    const withNew = applyTaskEvents(newer, [{ entity: inserted, version: 1 }]);
    expect(withNew.map((t) => t.name)).toEqual(['A', 'New', 'B', 'C']);
  });

  it('TC-121 over 1,000 cached tasks a batch [update, stale, new] applies 2 and ignores 1; untouched items keep references', () => {
    const list = Array.from({ length: 1000 }, (_, i) => task({ name: `Task ${i}`, sortOrder: i + 1, version: 2 }));
    const updated = list[10]!;
    const stale = list[500]!;
    const fresh = task({ name: 'Fresh', sortOrder: 2000 });
    const next = applyTaskEvents(list, [
      { entity: { ...updated, name: 'Updated' }, version: 3 },
      { entity: { ...stale, name: 'Stale' }, version: 1 },
      { entity: fresh, version: 1 },
    ]);
    expect(next).not.toBe(list);
    expect(next).toHaveLength(1001);
    expect(next[10]).toMatchObject({ name: 'Updated', version: 3 });
    expect(next[500]).toBe(stale);
    expect(next[1000]).toMatchObject({ id: fresh.id, name: 'Fresh' });
    const changed = next.filter((t, i) => i < 1000 && t !== list[i]);
    expect(changed).toHaveLength(1);
    expect(list[10]!.name).toBe('Task 10');
  });

  it('TC-122 a batch of only stale events returns the identical array', () => {
    const a = task({ version: 5 });
    const b = task({ version: 5 });
    const list = [a, b];
    expect(applyTaskEvents(list, [{ entity: { ...a, name: 'x' }, version: 5 }, { entity: { ...b, name: 'y' }, version: 4 }])).toBe(list);
    expect(applyTaskEvents(list, [])).toBe(list);
    expect(applyTaskEvents(undefined, [{ entity: a, version: 9 }])).toBeUndefined();
  });

  it('mergeLocalRows keeps unsaved rows the server does not have, after the server rows', () => {
    const saved = task({ name: 'Saved' });
    const failed = pending({ localStatus: 'failed', name: 'Failed' });
    const committed = pending({ name: 'Committed' });
    const server = [saved, { ...committed, localStatus: undefined, version: 1 }];
    const merged = mergeLocalRows(server as Task[], [saved, failed, committed]);
    expect(merged.map((t) => t.name)).toEqual(['Saved', 'Committed', 'Failed']);
    expect(mergeLocalRows(server as Task[], [saved])).toBe(server);
  });
});
