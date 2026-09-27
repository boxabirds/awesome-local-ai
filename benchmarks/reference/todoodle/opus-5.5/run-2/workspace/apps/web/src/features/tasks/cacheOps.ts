import type { Task } from '@todoodle/shared/schemas';
import type { LocalTask } from './localTask';

/*
 * Pure, immutable cache transforms for story 6's lifecycle (complete, reopen, edit, delete,
 * restore). A cached list is either open tasks only, or open tasks followed by completed ones
 * (includeCompleted). Helpers return the same array when nothing changed and keep the references
 * of untouched items (TaskRow's memo relies on it).
 */

type List = readonly LocalTask[] | undefined;

const isOpen = (task: Pick<Task, 'completedAt'>) => task.completedAt === null;

/** A task belongs in a list when it is open, or the list includes completed tasks. */
export function belongsIn(task: Pick<Task, 'completedAt'>, includeCompleted: boolean): boolean {
  return includeCompleted || isOpen(task);
}

/** `a` comes before `b` in list order (open by sortOrder, then completed most recent first; ties by id). */
function before(a: Pick<Task, 'id' | 'sortOrder' | 'completedAt'>, b: Pick<Task, 'id' | 'sortOrder' | 'completedAt'>): boolean {
  if (isOpen(a) !== isOpen(b)) return isOpen(a);
  if (isOpen(a)) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder < b.sortOrder;
  } else if (a.completedAt !== b.completedAt) {
    return a.completedAt! > b.completedAt!;
  }
  return a.id < b.id;
}

/** Index of the task in the list, or -1 (one pass; a Map index when looking up many ids). */
function indexOf(list: readonly LocalTask[], id: string): number {
  return list.findIndex((task) => task.id === id);
}

/** Id -> index, for batches (js-index-maps). */
export function indexById(list: readonly LocalTask[]): Map<string, number> {
  const index = new Map<string, number>();
  list.forEach((task, i) => index.set(task.id, i));
  return index;
}

/**
 * Puts `task` where list order says it goes, replacing any cached copy of it (by id). An open
 * task lands by sortOrder (so a reopened or restored task returns to its original position).
 */
export function insertBySortOrder(list: readonly LocalTask[], task: LocalTask): LocalTask[] {
  const at = indexById(list).get(task.id);
  const rest = at === undefined ? list : list.toSpliced(at, 1);
  const position = rest.findIndex((item) => before(task, item));
  return position === -1 ? [...rest, task] : rest.toSpliced(position, 0, task);
}

/** Places the task (or drops it when it no longer belongs, e.g. completed in an open-only list). */
export function placeTask<L extends List>(list: L, task: LocalTask, includeCompleted: boolean): L {
  if (!list) return list;
  if (!belongsIn(task, includeCompleted)) return removeFromCache(list, task.id);
  const at = indexOf(list, task.id);
  // Same position: replace in place (no reorder, no new neighbours).
  if (at !== -1) {
    const prev = list[at - 1];
    const next = list[at + 1];
    if ((!prev || before(prev, task)) && (!next || before(task, next))) {
      if (list[at] === task) return list;
      return list.with(at, task) as unknown as L;
    }
  }
  return insertBySortOrder(list, task) as unknown as L;
}

/** Marks the task completed: dropped from an open-only list, moved to the completed group otherwise. */
export function completeInCache<L extends List>(list: L, id: string, completedAt: string, includeCompleted: boolean): L {
  if (!list) return list;
  const at = indexOf(list, id);
  if (at === -1) return list;
  return placeTask(list, { ...list[at]!, completedAt }, includeCompleted);
}

/** The task open again, at its sortOrder position (inserted when the list didn't have it). */
export function reopenInCache<L extends List>(list: L, task: LocalTask, includeCompleted: boolean): L {
  return placeTask(list, { ...task, completedAt: null }, includeCompleted);
}

/** Changes name and/or description in place. */
export function updateInCache<L extends List>(list: L, id: string, patch: { name?: string; description?: string }): L {
  if (!list) return list;
  const at = indexOf(list, id);
  if (at === -1) return list;
  const current = list[at]!;
  const next = { ...current, ...patch };
  if (next.name === current.name && next.description === current.description) return list;
  return list.with(at, next) as unknown as L;
}

/** Removes the task (delete, or a completion in an open-only list). */
export function removeFromCache<L extends List>(list: L, id: string): L {
  if (!list) return list;
  const at = indexOf(list, id);
  if (at === -1) return list;
  return list.toSpliced(at, 1) as unknown as L;
}

/** The cached task with this id, if any. */
export function findInCache(list: List, id: string): LocalTask | undefined {
  return list?.find((task) => task.id === id);
}
