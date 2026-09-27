import type { Counts } from '@todoodle/shared/schemas';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { findInCache } from './cacheOps';
import type { LocalTask } from './localTask';
import { adjustCount } from './taskCache';

/*
 * Helpers over every cached task list of a workspace (open-only and with-completed variants), for
 * the lifecycle mutations and the live handlers.
 */

/** Whether a task-list query key includes completed tasks. */
export function includeCompletedOf(key: QueryKey): boolean {
  return (key[3] as { includeCompleted?: boolean } | undefined)?.includeCompleted === true;
}

/** Applies `fn` to every cached list; writes only the lists that changed. Returns true when any did. */
export function updateTaskLists(
  client: QueryClient,
  workspaceId: string,
  fn: (list: LocalTask[], includeCompleted: boolean) => LocalTask[],
): boolean {
  let changed = false;
  for (const [key, list] of client.getQueriesData<LocalTask[]>({ queryKey: qk.taskLists(workspaceId) })) {
    if (!list) continue;
    const next = fn(list, includeCompletedOf(key));
    if (next !== list) {
      client.setQueryData(key, next);
      changed = true;
    }
  }
  return changed;
}

/** The task as cached in any list (the newest version wins). */
export function findCachedTask(client: QueryClient, workspaceId: string, id: string): LocalTask | undefined {
  let found: LocalTask | undefined;
  for (const [, list] of client.getQueriesData<LocalTask[]>({ queryKey: qk.taskLists(workspaceId) })) {
    const task = findInCache(list, id);
    if (task && (!found || task.version > found.version)) found = task;
  }
  return found;
}

/** Every task list and the counts, as they are now (for rollback). */
export type CacheSnapshot = { lists: Array<[QueryKey, LocalTask[] | undefined]>; counts: Counts | undefined };

export function snapshotTaskCaches(client: QueryClient, workspaceId: string): CacheSnapshot {
  return {
    lists: client.getQueriesData<LocalTask[]>({ queryKey: qk.taskLists(workspaceId) }),
    counts: client.getQueryData<Counts>(qk.counts(workspaceId)),
  };
}

/** Puts every list and the counts back exactly as snapshotted. */
export function restoreTaskCaches(client: QueryClient, workspaceId: string, snapshot: CacheSnapshot): void {
  for (const [key, list] of snapshot.lists) client.setQueryData(key, list);
  if (snapshot.counts) client.setQueryData(qk.counts(workspaceId), snapshot.counts);
}

/** Changes the open-task count (never below 0). */
export function adjustOpenCount(client: QueryClient, workspaceId: string, delta: number): void {
  if (delta === 0) return;
  client.setQueriesData<Counts>({ queryKey: qk.counts(workspaceId) }, (counts) => adjustCount(counts, delta));
}

/*
 * Deleted tasks this tab knows about, with the version of the deletion when known. A task.upserted
 * for a deleted task can only predate the deletion (the server refuses changes to deleted tasks),
 * so it is ignored; task.restored applies only when newer than the deletion.
 */
const tombstones = new Map<string, number>();

export const taskTombstones = {
  add(id: string, version: number): void {
    tombstones.set(id, Math.max(version, tombstones.get(id) ?? 0));
  },
  get(id: string): number | undefined {
    return tombstones.get(id);
  },
  delete(id: string): void {
    tombstones.delete(id);
  },
  resetForTests(): void {
    tombstones.clear();
  },
};
