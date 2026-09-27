import { TASK_SORT_STEP } from '@todoodle/shared/limits';
import type { Counts, Task } from '@todoodle/shared/schemas';
import type { LocalStatus, LocalTask } from './localTask';

/*
 * Pure, immutable cache transforms for task lists. Every helper returns a new array only when
 * something changed and keeps the references of untouched items (the TaskRow memo relies on it).
 */

/** A task change from the server: the entity and its post-write version. */
export type TaskUpsert = { entity: Task; version: number };

/** Where a new task lands locally until the server answers: after everything shown. */
export function nextSortOrder(list: readonly LocalTask[] | undefined): number {
  let max = 0;
  for (const task of list ?? []) if (task.sortOrder > max) max = task.sortOrder;
  return max + TASK_SORT_STEP;
}

/** Adds an unsaved task at the end. */
export function appendOptimistic(list: readonly LocalTask[] | undefined, task: LocalTask): LocalTask[] {
  return [...(list ?? []), task];
}

/** Sets a local task's status; the text is kept as is. */
export function markStatus<L extends readonly LocalTask[] | undefined>(list: L, id: string, status: LocalStatus): L {
  if (!list) return list;
  const index = list.findIndex((task) => task.id === id);
  if (index === -1 || list[index]!.localStatus === status) return list;
  const next = list.slice();
  next[index] = { ...list[index]!, localStatus: status };
  return next as unknown as L;
}

/** Replaces the local task in place by the server's (no local status). Inserted by sortOrder if absent. */
export function replaceWithServer(list: readonly LocalTask[] | undefined, task: Task): LocalTask[] {
  if (!list) return [task];
  const index = list.findIndex((item) => item.id === task.id);
  if (index === -1) return insertBySortOrder(list.slice(), task);
  const next = list.slice();
  next[index] = task;
  return next;
}

/** Removes a task (Discard). */
export function removeLocal<L extends readonly LocalTask[] | undefined>(list: L, id: string): L {
  if (!list) return list;
  const index = list.findIndex((task) => task.id === id);
  if (index === -1) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)] as unknown as L;
}

/** Changes the Inbox count by `delta` (never below 0). Other fields (stories 7 and 8) are kept. */
export function adjustCount(counts: Counts | undefined, delta: number): Counts | undefined {
  if (!counts) return counts;
  return { ...counts, inbox: Math.max(0, counts.inbox + delta) };
}

function insertBySortOrder(list: LocalTask[], task: Task): LocalTask[] {
  const at = list.findIndex((item) => item.sortOrder > task.sortOrder);
  if (at === -1) list.push(task);
  else list.splice(at, 0, task);
  return list;
}

/**
 * Applies a batch of live task changes with ONE id index (O(n + k)): a newer version replaces the
 * cached task in place, an equal or older one is ignored, and a new id is inserted at its
 * sortOrder position. Returns the same array when nothing changed.
 */
export function applyTaskEvents<L extends readonly LocalTask[] | undefined>(list: L, events: readonly TaskUpsert[]): L {
  if (!list || events.length === 0) return list;
  const index = new Map<string, number>();
  list.forEach((task, i) => index.set(task.id, i));
  let next: LocalTask[] | null = null;
  const inserts = new Map<string, Task>();
  for (const { entity, version } of events) {
    const at = index.get(entity.id);
    if (at === undefined) {
      const pending = inserts.get(entity.id);
      if (!pending || version > pending.version) inserts.set(entity.id, { ...entity, version });
      continue;
    }
    const current = (next ?? list)[at]!;
    if (version <= current.version) continue;
    next ??= list.slice();
    next[at] = { ...entity, version };
  }
  if (inserts.size > 0) {
    next ??= list.slice();
    for (const task of inserts.values()) insertBySortOrder(next, task);
  }
  return (next ?? list) as L;
}

/**
 * A refetched list keeps this tab's unsaved rows (saving, failed or rejected) that the server
 * doesn't have yet, so typed text is never lost to a background refetch.
 */
export function mergeLocalRows(server: Task[], cached: readonly LocalTask[] | undefined): LocalTask[] {
  const local = cached?.filter((task) => task.localStatus !== undefined) ?? [];
  if (local.length === 0) return server;
  const ids = new Set(server.map((task) => task.id));
  const missing = local.filter((task) => !ids.has(task.id));
  return missing.length === 0 ? server : [...server, ...missing];
}
