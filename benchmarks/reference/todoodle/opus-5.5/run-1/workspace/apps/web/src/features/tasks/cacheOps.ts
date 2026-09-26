import type { Task } from '@todoodle/shared/schemas';
import type { LocalTask } from './taskCache';

// Pure, immutable cache operations for story 6 (complete, reopen, edit, delete, restore). Every cached list
// keeps the one task order: open tasks by sortOrder, then (includeCompleted lists only) completed tasks by
// completedAt descending. A `leaving` task still sits in its open position. Each op returns the SAME array
// when nothing changed, and keeps the references of untouched items (TaskRow's memo relies on it).

/** What a list holds: its open tasks only, or its completed ones too. */
export type ListShape = { includeCompleted: boolean };

/** id -> index, built in one pass (js-index-maps). */
export function indexById(list: readonly LocalTask[]): Map<string, number> {
  const index = new Map<string, number>();
  list.forEach((task, i) => index.set(task.id, i));
  return index;
}

/** Whether a task shows in the open group (a leaving task still does). */
export function isOpenRow(task: Pick<LocalTask, 'completedAt' | 'leaving'>): boolean {
  return task.completedAt === null || task.leaving === true;
}

/** Removes one task. */
export function removeFromCache(list: LocalTask[] | undefined, id: string): LocalTask[] | undefined {
  if (!list) return list;
  const index = indexById(list).get(id);
  if (index === undefined) return list;
  return list.toSpliced(index, 1);
}

/** Index of the first completed (non-leaving) row: the end of the open group. */
function openGroupEnd(list: readonly LocalTask[]): number {
  const end = list.findIndex((task) => !isOpenRow(task));
  return end === -1 ? list.length : end;
}

/**
 * Inserts an open task among the open rows by sortOrder (after equal ones), replacing any row with its id.
 * Binary search over the open group.
 */
export function insertBySortOrder(list: LocalTask[] | undefined, task: LocalTask): LocalTask[] {
  const base = removeFromCache(list, task.id) ?? [];
  let low = 0;
  let high = openGroupEnd(base);
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (base[mid]!.sortOrder <= task.sortOrder) low = mid + 1;
    else high = mid;
  }
  return base.toSpliced(low, 0, task);
}

/** Inserts a completed task into the completed group (completedAt descending, then id). */
function insertCompleted(list: LocalTask[], task: LocalTask): LocalTask[] {
  let index = openGroupEnd(list);
  while (index < list.length) {
    const other = list[index]!;
    const later = other.completedAt! > task.completedAt! || (other.completedAt === task.completedAt && other.id < task.id);
    if (!later) break;
    index++;
  }
  return list.toSpliced(index, 0, task);
}

/**
 * Puts a task where it belongs in this list: open -> by sortOrder; completed -> the completed group
 * (includeCompleted lists) or nowhere (open-only lists). Replaces any existing row with its id.
 */
export function placeTask(list: LocalTask[] | undefined, task: LocalTask, shape: ListShape): LocalTask[] | undefined {
  if (task.completedAt === null) return insertBySortOrder(list, task);
  const base = removeFromCache(list, task.id);
  if (!shape.includeCompleted) return base;
  return insertCompleted(base ?? [], task);
}

/**
 * Completes a task. `leaving`: the row stays in its open position, ticked, flagged as leaving (the
 * animation); finishLeaving moves it later. Otherwise it goes straight to where completed tasks go.
 */
export function completeInCache(
  list: LocalTask[] | undefined,
  id: string,
  completedAt: string,
  opts: ListShape & { leaving: boolean },
): LocalTask[] | undefined {
  if (!list) return list;
  const index = indexById(list).get(id);
  if (index === undefined) return list;
  const current = list[index]!;
  if (current.completedAt !== null && !current.leaving) return list;
  if (opts.leaving) return list.with(index, { ...current, completedAt, leaving: true });
  const { leaving: _leaving, ...settled } = current;
  return placeTask(list, { ...settled, completedAt }, opts);
}

/** The leaving animation is over: the completed task leaves the open group (and the list, if open-only). */
export function finishLeaving(list: LocalTask[] | undefined, id: string, shape: ListShape): LocalTask[] | undefined {
  if (!list) return list;
  const index = indexById(list).get(id);
  if (index === undefined) return list;
  const current = list[index]!;
  if (!current.leaving) return list;
  const { leaving: _leaving, ...settled } = current;
  return placeTask(list, settled, shape);
}

/** Reopens a task: it returns to the open group at its sortOrder (its original position). */
export function reopenInCache(list: LocalTask[] | undefined, task: LocalTask, shape: ListShape): LocalTask[] | undefined {
  const { leaving: _leaving, ...rest } = task;
  return placeTask(list, { ...rest, completedAt: null }, shape);
}

/**
 * Writes a newer copy of a task that is already cached (an edit, or the server's answer), in place.
 * A task still leaving keeps its flag; a settled task is re-placed if its completion state changed.
 */
export function updateInCache(list: LocalTask[] | undefined, task: Task, shape: ListShape): LocalTask[] | undefined {
  if (!list) return list;
  const index = indexById(list).get(task.id);
  if (index === undefined) return list;
  const current = list[index]!;
  if (current.leaving) return list.with(index, { ...task, completedAt: task.completedAt ?? current.completedAt, leaving: true });
  const next: LocalTask = { ...task };
  if (current.completedAt === next.completedAt) return list.with(index, next);
  return placeTask(list, next, shape);
}

/**
 * Undoes one task's optimistic change: the task goes back exactly as it was in `snapshot` (same neighbours,
 * so the same index), or is removed if the snapshot did not have it. Other rows are left as they are now, so
 * a concurrent change to another task survives the rollback.
 */
export function rollbackTask(current: LocalTask[] | undefined, snapshot: LocalTask[] | undefined, id: string): LocalTask[] | undefined {
  if (!snapshot) return current;
  const before = snapshot.find((task) => task.id === id);
  const without = removeFromCache(current, id) ?? [];
  if (!before) return without;
  const snapshotIndex = snapshot.indexOf(before);
  const positions = indexById(without);
  for (let i = snapshotIndex - 1; i >= 0; i--) {
    const at = positions.get(snapshot[i]!.id);
    if (at !== undefined) return without.toSpliced(at + 1, 0, before);
  }
  return without.toSpliced(0, 0, before);
}

/** Finds a task in any of the given lists. */
export function findTask(lists: ReadonlyArray<LocalTask[] | undefined>, id: string): LocalTask | undefined {
  for (const list of lists) {
    const found = list?.find((task) => task.id === id);
    if (found) return found;
  }
  return undefined;
}
