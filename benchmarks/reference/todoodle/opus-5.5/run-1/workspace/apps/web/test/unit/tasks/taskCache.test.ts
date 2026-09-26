import type { Task } from '@todoodle/shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  type LocalTask,
  adjustCount,
  appendOptimistic,
  applyTaskEvents,
  markStatus,
  mergeLocalRows,
  removeLocal,
  replaceWithServer,
} from '@/features/tasks/taskCache';
import { makeTask } from '../../msw/tasks.ts';

const A = makeTask({ name: 'Buy milk' }, 0);
const B = makeTask({ name: 'Email Sam re: invoice #4411' }, 1);
const P: LocalTask = { ...makeTask({ name: 'Call Mum 📞', description: 'Sunday\nafter lunch' }, 2), version: 0 };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

describe('tasks.client_cache helpers', () => {
  it('TC-60 appendOptimistic adds P at the end as pending and never mutates its input', () => {
    const list = deepFreeze([A]);
    const next = appendOptimistic(list, P);
    expect(next).toEqual([A, { ...P, localStatus: 'pending' }]);
    expect(next[0]).toBe(A);
    expect(list).toEqual([A]);
    expect(appendOptimistic(undefined, P)).toEqual([{ ...P, localStatus: 'pending' }]);
  });

  it('TC-61 markStatus failed keeps the name and description', () => {
    const list = deepFreeze(appendOptimistic([A], P));
    const next = markStatus(list, P.id, 'failed')!;
    expect(next[1]).toMatchObject({ localStatus: 'failed', name: 'Call Mum 📞', description: 'Sunday\nafter lunch' });
    expect(next[0]).toBe(A);
    expect(list[1]!.localStatus).toBe('pending');
    // Unknown id or same status: the same reference.
    expect(markStatus(next, 'f'.repeat(32), 'failed')).toBe(next);
    expect(markStatus(next, P.id, 'failed')).toBe(next);
  });

  it('TC-62 replaceWithServer replaces the pending row in place with no local status', () => {
    const list = deepFreeze([...appendOptimistic([A], P), B]);
    const server: Task = { ...P, version: 1, createdAt: '2026-09-26 10:01:00', updatedAt: '2026-09-26 10:01:00' };
    const next = replaceWithServer(list, server);
    expect(next.map((t) => t.id)).toEqual([A.id, P.id, B.id]);
    expect(next[1]).toEqual(server);
    expect(next[1]).not.toHaveProperty('localStatus');
    expect(next[0]).toBe(A);
    expect(next[2]).toBe(B);
  });

  it('TC-63 removeLocal removes P and keeps A as the same reference', () => {
    const list = deepFreeze([A, { ...P, localStatus: 'failed' as const }]);
    const next = removeLocal(list, P.id)!;
    expect(next).toEqual([A]);
    expect(next[0]).toBe(A);
    expect(removeLocal(next, P.id)).toBe(next);
  });

  it('adjustCount moves the Inbox count, never below zero, keeping other fields', () => {
    expect(adjustCount({ inbox: 3 }, 1)).toEqual({ inbox: 4 });
    expect(adjustCount({ inbox: 0 }, -1)).toEqual({ inbox: 0 });
    expect(adjustCount(undefined, 1)).toBeUndefined();
    expect(adjustCount({ inbox: 2, today: 5 } as { inbox: number; today: number }, -1)).toEqual({ inbox: 1, today: 5 });
  });

  it('mergeLocalRows keeps unsaved rows after a refetch, and prefers the server copy once it exists', () => {
    const failed = { ...P, localStatus: 'failed' as const };
    expect(mergeLocalRows([A, B], [A, failed])).toEqual([A, B, failed]);
    expect(mergeLocalRows([A, B], [A])).toEqual([A, B]);
    const saved: Task = { ...P, version: 1 };
    expect(mergeLocalRows([A, saved], [A, { ...P, localStatus: 'pending' }])).toEqual([A, saved]);
  });
});

describe('applyTaskEvents', () => {
  it('TC-64 a higher version replaces; lower or equal is ignored; a new id goes in at its sortOrder', () => {
    const v2 = { ...B, name: 'v2', version: 2 };
    const list = deepFreeze([A, v2]);
    const v3 = { ...B, name: 'v3', version: 3 };
    const replaced = applyTaskEvents(list, [{ entity: v3, version: 3 }])!;
    expect(replaced[1]).toMatchObject({ name: 'v3', version: 3 });
    expect(replaced[0]).toBe(A);

    expect(applyTaskEvents(replaced, [{ entity: { ...B, name: 'old', version: 2 }, version: 2 }])).toBe(replaced);
    expect(applyTaskEvents(replaced, [{ entity: { ...B, name: 'same', version: 3 }, version: 3 }])).toBe(replaced);

    // A new task whose sortOrder falls between A (1) and B (2).
    const between = makeTask({ name: 'Between', sortOrder: 1.5 });
    const inserted = applyTaskEvents(replaced, [{ entity: between, version: 1 }])!;
    expect(inserted.map((t) => t.name)).toEqual(['Buy milk', 'Between', 'v3']);
    const last = makeTask({ name: 'Last', sortOrder: 99 });
    expect(applyTaskEvents(inserted, [{ entity: last, version: 1 }])!.map((t) => t.name).at(-1)).toBe('Last');
  });

  it('a pending local row (version 0) is replaced by the server copy', () => {
    const list = appendOptimistic([A], P);
    const next = applyTaskEvents(list, [{ entity: { ...P, version: 1 }, version: 1 }])!;
    expect(next[1]).not.toHaveProperty('localStatus');
  });

  it('TC-121 over 1,000 cached tasks, [update, stale, new] applies 2 and ignores 1; untouched items keep references', () => {
    const list = deepFreeze(Array.from({ length: 1_000 }, (_, i) => makeTask({ name: `Task ${i}`, sortOrder: i + 1, version: 2 })));
    const updated = { ...list[500]!, name: 'Updated', version: 3 };
    const stale = { ...list[10]!, name: 'Stale', version: 1 };
    const fresh = makeTask({ name: 'New', sortOrder: 1_001 });
    const next = applyTaskEvents(list, [
      { entity: updated, version: 3 },
      { entity: stale, version: 1 },
      { entity: fresh, version: 1 },
    ])!;
    expect(next).toHaveLength(1_001);
    expect(next[500]).toMatchObject({ name: 'Updated', version: 3 });
    expect(next[10]).toBe(list[10]);
    expect(next[1_000]).toMatchObject({ name: 'New' });
    const changed = next.filter((task, i) => task !== list[i]);
    expect(changed.map((t) => t.name)).toEqual(['Updated', 'New']);
  });

  it('TC-122 a batch of only stale events returns the identical array reference', () => {
    const list = deepFreeze([{ ...A, version: 5 }, { ...B, version: 5 }]);
    const events = [
      { entity: { ...A, name: 'x', version: 4 }, version: 4 },
      { entity: { ...B, name: 'y', version: 5 }, version: 5 },
    ];
    expect(applyTaskEvents(list, events)).toBe(list);
    expect(applyTaskEvents(list, [])).toBe(list);
    expect(applyTaskEvents(undefined, events)).toBeUndefined();
  });
});
