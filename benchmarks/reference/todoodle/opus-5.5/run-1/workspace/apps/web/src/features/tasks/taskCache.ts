import type { Counts, Task } from '@todoodle/shared/schemas';

/**
 * Where an unsaved row stands. `pending`: the create is in flight. `failed`: it may not have reached
 * Todoodle (network, timeout, 5xx); Retry resends the same id. `rejected`: Todoodle refused the content
 * (400, 409, 410), so only Discard is offered. Saved rows have no local status.
 */
export type LocalStatus = 'pending' | 'failed' | 'rejected';

/** A cached task, possibly one that exists only on this device so far. */
export type LocalTask = Task & { localStatus?: LocalStatus };

/** The version an optimistic row carries: any server copy (version >= 1) replaces it. */
export const LOCAL_VERSION = 0;

// Pure, immutable helpers. Each returns a new array only when something changed, and keeps the
// references of untouched items: TaskRow's memo relies on it.

/** Appends a new local row with `pending` status at the end (newest last). */
export function appendOptimistic(list: LocalTask[] | undefined, task: LocalTask): LocalTask[] {
  return [...(list ?? []), { ...task, localStatus: 'pending' }];
}

/** Sets the local status of one row, keeping its text. */
export function markStatus(list: LocalTask[] | undefined, id: string, status: LocalStatus): LocalTask[] | undefined {
  if (!list) return list;
  const index = list.findIndex((task) => task.id === id);
  if (index === -1 || list[index]!.localStatus === status) return list;
  const next = [...list];
  next[index] = { ...list[index]!, localStatus: status };
  return next;
}

/** Replaces the local row with the server's task in place (no local status). Appends it if the row is gone. */
export function replaceWithServer(list: LocalTask[] | undefined, task: Task): LocalTask[] {
  if (!list) return [task];
  const index = list.findIndex((item) => item.id === task.id);
  if (index === -1) return [...list, task];
  const next = [...list];
  next[index] = task;
  return next;
}

/** Removes a row (Discard). */
export function removeLocal(list: LocalTask[] | undefined, id: string): LocalTask[] | undefined {
  if (!list) return list;
  const index = list.findIndex((task) => task.id === id);
  if (index === -1) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

/** Adds `delta` to the Inbox count (never below zero). Story 7/8 fields pass through untouched. */
export function adjustCount<T extends Counts>(counts: T | undefined, delta: number): T | undefined {
  if (!counts) return counts;
  return { ...counts, inbox: Math.max(0, counts.inbox + delta) };
}

/** Index at which a task with this sortOrder goes: after every row with a lower or equal sortOrder. */
function insertionIndex(list: LocalTask[], sortOrder: number): number {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (list[mid]!.sortOrder <= sortOrder) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** A live change to one task (task.upserted), as story 4's dispatcher delivers it. */
export type TaskEvent = { entity: Task; version: number };

/**
 * Applies a batch of live task events with ONE id index over the cached list (O(n + k)):
 * - a cached id is replaced in place when the event's version is higher, and ignored otherwise;
 * - a new id is inserted at its sortOrder position.
 * Returns the same array reference when nothing changed.
 */
export function applyTaskEvents(list: LocalTask[] | undefined, events: readonly TaskEvent[]): LocalTask[] | undefined {
  if (!list || events.length === 0) return list;
  const indexById = new Map<string, number>();
  list.forEach((task, index) => indexById.set(task.id, index));

  let next: LocalTask[] | null = null;
  const inserts = new Map<string, Task>();
  for (const event of events) {
    const entity = { ...event.entity, version: event.version };
    const index = indexById.get(entity.id);
    if (index !== undefined) {
      const current = (next ?? list)[index]!;
      if (event.version <= current.version) continue;
      next ??= [...list];
      next[index] = entity;
      continue;
    }
    const pending = inserts.get(entity.id);
    if (!pending || pending.version < event.version) inserts.set(entity.id, entity);
  }
  if (inserts.size === 0) return next ?? list;

  const result = next ?? [...list];
  for (const task of inserts.values()) result.splice(insertionIndex(result, task.sortOrder), 0, task);
  return result;
}

/**
 * A freshly fetched list plus the rows that exist only on this device (not saved yet), in their cached
 * order after the server rows. A row the server now has is the server's copy.
 */
export function mergeLocalRows(fetched: Task[], cached: LocalTask[] | undefined): LocalTask[] {
  const local = cached?.filter((task) => task.localStatus !== undefined) ?? [];
  if (local.length === 0) return fetched;
  const fetchedIds = new Set(fetched.map((task) => task.id));
  const unsaved = local.filter((task) => !fetchedIds.has(task.id));
  return unsaved.length === 0 ? fetched : [...fetched, ...unsaved];
}
