import { QueryClient } from '@tanstack/react-query';
import type { Counts, RescheduleResponse } from '@todoodle/shared/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClockStoreForTests } from '@/features/dates/clockStore';
import type { LocalTask } from '@/features/tasks/taskCache';
import { type TodayData, type TodayRow, applyTodayChanges, countsTowardsToday, mirrorTaskToToday } from '@/features/today/todayCache';
import { rescheduleResultToUndoItems } from '@/features/today/useReschedule';
import { queryKeys } from '@/lib/queryKeys';

const DATE = '2026-09-25';

function row(id: string, dueDate: string | null, patch: Partial<TodayRow> = {}): TodayRow {
  return {
    id: id.padEnd(32, '0'),
    workspaceId: 'W',
    projectId: null,
    name: id,
    description: '',
    sortOrder: 1,
    completedAt: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    dueDate,
    projectName: null,
    projectColor: null,
    ...patch,
  };
}

function data(rows: { overdue?: TodayRow[]; today?: TodayRow[]; completed?: TodayRow[] }): TodayData {
  return { date: DATE, overdue: rows.overdue ?? [], today: rows.today ?? [], completed: rows.completed ?? [] };
}

describe('TC-62 rescheduleResultToUndoItems', () => {
  it('maps each changed task to {id, dueDate: previousDueDate, expectedVersion: version}', () => {
    const changed: RescheduleResponse['changed'] = [
      { id: 'a'.repeat(32), previousDueDate: '2026-09-20', dueDate: DATE, version: 2 },
      { id: 'b'.repeat(32), previousDueDate: '2026-09-24', dueDate: DATE, version: 7 },
    ];
    expect(rescheduleResultToUndoItems(changed)).toEqual([
      { id: 'a'.repeat(32), dueDate: '2026-09-20', expectedVersion: 2 },
      { id: 'b'.repeat(32), dueDate: '2026-09-24', expectedVersion: 7 },
    ]);
    expect(rescheduleResultToUndoItems([])).toEqual([]);
  });
});

describe('applyTodayChanges', () => {
  it('rescheduling moves overdue rows into today by sort order; untouched rows keep their references', () => {
    const a = row('a', '2026-09-20', { sortOrder: 5 });
    const b = row('b', '2026-09-24', { sortOrder: 1 });
    const c = row('c', DATE, { sortOrder: 3 });
    const before = data({ overdue: [a, b], today: [c] });
    const after = applyTodayChanges(before, new Map([[a.id, { ...a, dueDate: DATE }], [b.id, { ...b, dueDate: DATE }]]))!;
    expect(after.overdue).toEqual([]);
    expect(after.today.map((r) => r.name)).toEqual(['b', 'c', 'a']);
    expect(after.today[1]).toBe(c);
  });

  it('restoring dates puts rows back in Overdue by due date then sort order', () => {
    const a = row('a', DATE, { sortOrder: 5 });
    const b = row('b', DATE, { sortOrder: 1 });
    const x = row('x', '2026-09-22', { sortOrder: 9 });
    const after = applyTodayChanges(data({ overdue: [x], today: [b, a] }), new Map([[a.id, { ...a, dueDate: '2026-09-20' }], [b.id, { ...b, dueDate: '2026-09-24' }]]))!;
    expect(after.overdue.map((r) => r.name)).toEqual(['a', 'x', 'b']);
    expect(after.today).toEqual([]);
  });

  it('a future date, no date or null (deleted) takes the row out; a completed row due today joins completed', () => {
    const a = row('a', DATE);
    const b = row('b', DATE);
    const c = row('c', '2026-09-24');
    const d = row('d', DATE);
    const after = applyTodayChanges(
      data({ overdue: [c], today: [a, b, d] }),
      new Map<string, TodayRow | null>([
        [a.id, { ...a, dueDate: '2026-09-30' }],
        [b.id, { ...b, dueDate: null }],
        [c.id, null],
        [d.id, { ...d, completedAt: '2026-09-25T10:00:00Z' }],
      ]),
    )!;
    expect(after.overdue).toEqual([]);
    expect(after.today).toEqual([]);
    expect(after.completed.map((r) => r.name)).toEqual(['d']);
  });

  it('a completing (leaving) row stays in its open group', () => {
    const a = row('a', '2026-09-24');
    const after = applyTodayChanges(data({ overdue: [a] }), new Map([[a.id, { ...a, completedAt: 'x', leaving: true }]]))!;
    expect(after.overdue.map((r) => r.leaving)).toEqual([true]);
  });

  it('returns the same object when nothing changes', () => {
    const before = data({ today: [row('a', DATE)] });
    expect(applyTodayChanges(before, new Map())).toBe(before);
    expect(applyTodayChanges(before, new Map([['nope', null]]))).toBe(before);
    expect(applyTodayChanges(undefined, new Map([['nope', null]]))).toBeUndefined();
  });
});

describe('countsTowardsToday', () => {
  it.each([
    ['open, overdue', row('a', '2026-09-24'), true],
    ['open, due today', row('a', DATE), true],
    ['open, future', row('a', '2026-09-26'), false],
    ['undated', row('a', null), false],
    ['completed', row('a', DATE, { completedAt: 'x' }), false],
    ['not saved yet', row('a', DATE, { localStatus: 'pending' }), false],
  ])('%s -> %s', (_label, task, expected) => {
    expect(countsTowardsToday(task, DATE)).toBe(expected);
  });
});

describe('mirrorTaskToToday (the task actions keep Today in step)', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    resetClockStoreForTests();
    queryClient = new QueryClient();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetClockStoreForTests();
  });

  const key = () => queryKeys.today('W', { date: DATE, includeCompleted: false });
  const counts = () => queryClient.getQueryData<Counts>(queryKeys.counts('W'));

  it('dating an Inbox task today adds it to every cached Today (project tag from the projects cache) and +1 to the count', () => {
    queryClient.setQueryData(key(), data({}));
    queryClient.setQueryData(queryKeys.counts('W'), { inbox: 1, projects: {}, today: 0 });
    queryClient.setQueryData(queryKeys.projects('W'), [{ id: 'p'.repeat(32), name: 'Work', color: 'red' }]);
    const task: LocalTask = { ...row('a', null), projectId: 'p'.repeat(32) };
    mirrorTaskToToday(queryClient, 'W', task.id, { ...task, dueDate: DATE }, task);
    expect(queryClient.getQueryData<TodayData>(key())!.today.map((r) => [r.name, r.projectName, r.projectColor])).toEqual([['a', 'Work', 'red']]);
    expect(counts()?.today).toBe(1);
  });

  it('a rollback is the same call reversed: the row and the count come back', () => {
    const task = row('a', '2026-09-24');
    queryClient.setQueryData(key(), data({ overdue: [task] }));
    queryClient.setQueryData(queryKeys.counts('W'), { inbox: 1, projects: {}, today: 1 });
    const done = { ...task, completedAt: '2026-09-25T12:00:00Z' };
    mirrorTaskToToday(queryClient, 'W', task.id, done, task);
    expect(queryClient.getQueryData<TodayData>(key())!.overdue).toEqual([]);
    expect(counts()?.today).toBe(0);
    mirrorTaskToToday(queryClient, 'W', task.id, task, done);
    expect(queryClient.getQueryData<TodayData>(key())!.overdue.map((r) => r.name)).toEqual(['a']);
    expect(counts()?.today).toBe(1);
  });

  it('counts without a today field (no date sent) are left alone', () => {
    queryClient.setQueryData(queryKeys.counts('W'), { inbox: 1, projects: {} });
    const task = row('a', null);
    mirrorTaskToToday(queryClient, 'W', task.id, { ...task, dueDate: DATE }, task);
    expect(counts()).toEqual({ inbox: 1, projects: {} });
  });
});
