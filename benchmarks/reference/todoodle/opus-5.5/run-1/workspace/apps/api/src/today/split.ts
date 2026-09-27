import type { TodayResponse, TodayTask } from '@todoodle/shared/schemas';

type Splittable = Pick<TodayTask, 'dueDate' | 'completedAt' | 'sortOrder' | 'id'>;

/**
 * Splits Today's rows for the viewer's `date` in one pass: completed (due on date) -> completed, open due before
 * date -> overdue, open due on date -> today. Anything else (undated, future, completed on another day) is left
 * out. Rows arrive ordered by due date then sort order, so overdue keeps that order and today is by sort order;
 * completed is then ordered most recently completed first.
 */
export function splitToday<T extends Splittable>(rows: readonly T[], date: string): { overdue: T[]; today: T[]; completed: T[] } {
  const overdue: T[] = [];
  const today: T[] = [];
  const completed: T[] = [];
  for (const row of rows) {
    if (row.dueDate === null || row.dueDate > date) continue;
    if (row.completedAt !== null) {
      if (row.dueDate === date) completed.push(row);
    } else if (row.dueDate < date) overdue.push(row);
    else today.push(row);
  }
  completed.sort((a, b) => (a.completedAt! === b.completedAt! ? (a.id < b.id ? -1 : 1) : a.completedAt! < b.completedAt! ? 1 : -1));
  return { overdue, today, completed };
}

/** The response body for GET today. */
export function todayResponse(rows: readonly TodayTask[], date: string): TodayResponse {
  return { date, ...splitToday(rows, date) };
}
