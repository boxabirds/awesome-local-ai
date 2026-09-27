import { describe, expect, it } from 'vitest';
import { splitToday } from '../../src/today/split.ts';

// Story 8, today.query: splitToday's equivalence classes (overdue, today, completed, excluded) and ordering.

const DATE = '2026-09-25';
type Row = { id: string; dueDate: string | null; completedAt: string | null; sortOrder: number };
const row = (id: string, dueDate: string | null, sortOrder = 1, completedAt: string | null = null): Row => ({ id, dueDate, completedAt, sortOrder });

describe('splitToday', () => {
  it('open and due before the date -> overdue; on the date -> today; completed on the date -> completed', () => {
    const rows = [row('a', '2026-09-20'), row('b', DATE), row('c', DATE, 2, '2026-09-25T08:00:00Z')];
    const { overdue, today, completed } = splitToday(rows, DATE);
    expect(overdue.map((r) => r.id)).toEqual(['a']);
    expect(today.map((r) => r.id)).toEqual(['b']);
    expect(completed.map((r) => r.id)).toEqual(['c']);
  });

  it('excluded: undated, future, and completed on another day', () => {
    const rows = [row('none', null), row('future', '2026-09-26'), row('old-done', '2026-09-20', 1, '2026-09-21T08:00:00Z')];
    expect(splitToday(rows, DATE)).toEqual({ overdue: [], today: [], completed: [] });
  });

  it('keeps the query order (due date, then sort order) for overdue and today', () => {
    const rows = [row('o1', '2026-09-01', 9), row('o2', '2026-09-24', 1), row('o3', '2026-09-24', 4), row('t1', DATE, 1), row('t2', DATE, 7)];
    const { overdue, today } = splitToday(rows, DATE);
    expect(overdue.map((r) => r.id)).toEqual(['o1', 'o2', 'o3']);
    expect(today.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('orders completed most recently completed first (ties by id)', () => {
    const rows = [row('x', DATE, 1, '2026-09-25T08:00:00Z'), row('y', DATE, 2, '2026-09-25T10:00:00Z'), row('w', DATE, 3, '2026-09-25T08:00:00Z')];
    expect(splitToday(rows, DATE).completed.map((r) => r.id)).toEqual(['y', 'w', 'x']);
  });

  it('the boundaries are per date: the same rows split differently for another viewer date', () => {
    const rows = [row('a', '2026-09-25')];
    expect(splitToday(rows, '2026-09-26').overdue.map((r) => r.id)).toEqual(['a']);
    expect(splitToday(rows, '2026-09-24')).toEqual({ overdue: [], today: [], completed: [] });
  });
});
