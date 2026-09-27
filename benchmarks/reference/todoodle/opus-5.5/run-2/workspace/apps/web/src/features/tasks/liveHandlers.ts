import { TaskSchema, type Task } from '@todoodle/shared/schemas';
import { type HandlerCtx, type LiveHandler, registerLiveHandler } from '@/features/live/registry';
import { qk } from '@/lib/queryKeys';
import { findInCache, placeTask, removeFromCache } from './cacheOps';
import type { LocalTask } from './localTask';
import { adjustOpenCount, includeCompletedOf, taskTombstones } from './taskLists';

/*
 * Live task changes from other people (story 4's dispatcher has already dropped this tab's own
 * echoes and runs a frame's events inside one notification batch). Every cached list of the
 * workspace is patched: open-only lists and lists with completed tasks.
 */

/** Refetch instead of guessing when an entity doesn't parse. */
function refetchAll({ queryClient, workspaceId }: HandlerCtx): 'stale' {
  void queryClient.invalidateQueries({ queryKey: qk.taskLists(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: qk.counts(workspaceId) });
  return 'stale';
}

/**
 * Places a newer version of a task in every cached list (at its list position; dropped from
 * open-only lists once completed) and keeps the open count in step. Equal or older versions are
 * ignored. Returns true when any list changed.
 */
function applyTask({ queryClient, workspaceId }: HandlerCtx, task: Task): { applied: boolean; cached: boolean } {
  let applied = false;
  let cached = false;
  let openDelta: number | null = null;
  for (const [key, list] of queryClient.getQueriesData<LocalTask[]>({ queryKey: qk.taskLists(workspaceId) })) {
    if (!list) continue;
    cached = true;
    const current = findInCache(list, task.id);
    if (current && current.version >= task.version) continue;
    const includeCompleted = includeCompletedOf(key);
    const next = placeTask(list, task, includeCompleted);
    if (next === list) continue;
    queryClient.setQueryData(key, next);
    applied = true;
    if (!includeCompleted) openDelta = (task.completedAt === null ? 1 : 0) - (current ? 1 : 0);
  }
  if (openDelta !== null) adjustOpenCount(queryClient, workspaceId, openDelta);
  return { applied, cached };
}

function parseTask(ctx: HandlerCtx, entity: unknown, version: number): Task | null {
  const parsed = TaskSchema.safeParse(entity);
  if (!parsed.success || parsed.data.workspaceId !== ctx.workspaceId) return null;
  return { ...parsed.data, version };
}

/** Someone created, completed, reopened or edited a task. */
export const applyTaskUpserted: LiveHandler<'task.upserted'> = (ctx, event) => {
  const task = parseTask(ctx, event.entity, event.version);
  if (!task) return TaskSchema.safeParse(event.entity).success ? 'stale' : refetchAll(ctx);
  // Deleted here already: this change predates the deletion.
  if (taskTombstones.get(task.id) !== undefined) return 'stale';
  return applyTask(ctx, task).applied ? 'applied' : 'stale';
};

/** Someone restored (undid the deletion of) a task: back at its sortOrder position, if newer. */
export const applyTaskRestored: LiveHandler<'task.restored'> = (ctx, event) => {
  const task = parseTask(ctx, event.entity, event.version);
  if (!task) return TaskSchema.safeParse(event.entity).success ? 'stale' : refetchAll(ctx);
  const deletedAt = taskTombstones.get(task.id);
  if (deletedAt !== undefined && event.version <= deletedAt) return 'stale';
  const { applied } = applyTask(ctx, task);
  if (applied) taskTombstones.delete(task.id);
  return applied ? 'applied' : 'stale';
};

/** Someone deleted a task: gone from every list (the edit guard then closes an open editor). */
export const applyTaskDeleted: LiveHandler<'task.deleted'> = ({ queryClient, workspaceId }, event) => {
  const id = event.entity.id;
  taskTombstones.add(id, event.version);
  let applied = false;
  let wasOpen = false;
  for (const [key, list] of queryClient.getQueriesData<LocalTask[]>({ queryKey: qk.taskLists(workspaceId) })) {
    const current = findInCache(list, id);
    if (!list || !current) continue;
    if (current.version >= event.version) continue;
    if (!includeCompletedOf(key)) wasOpen = true;
    queryClient.setQueryData(key, removeFromCache(list, id));
    applied = true;
  }
  if (wasOpen) adjustOpenCount(queryClient, workspaceId, -1);
  return applied ? 'applied' : 'stale';
};

/** Registers the task handlers (added to the registry's set; never replaces another). Returns the unregister. */
export function registerTaskHandlers(): () => void {
  const off = [
    registerLiveHandler('task.upserted', applyTaskUpserted),
    registerLiveHandler('task.restored', applyTaskRestored),
    registerLiveHandler('task.deleted', applyTaskDeleted),
  ];
  return () => off.forEach((fn) => fn());
}
