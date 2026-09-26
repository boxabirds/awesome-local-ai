import type { QueryKey } from '@tanstack/react-query';
import type { LiveEvent } from '@todoodle/shared/events';
import { type Counts, type Task, TaskSchema } from '@todoodle/shared/schemas';
import { type HandlerCtx, registerLiveHandler } from '@/features/live/registry';
import { type TasksFilter, queryKeys } from '@/lib/queryKeys';
import { findTask, placeTask, removeFromCache, updateInCache } from './cacheOps';
import { type LocalTask, adjustCount } from './taskCache';

type CachedList = { key: QueryKey; list: LocalTask[] | undefined; filter: TasksFilter };

function cachedLists(ctx: HandlerCtx): CachedList[] {
  const lists: CachedList[] = [];
  for (const [key, list] of ctx.queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(ctx.workspaceId) })) {
    const filter = key[3] as TasksFilter | undefined;
    if (filter) lists.push({ key, list, filter });
  }
  return lists;
}

function adjustCounts(ctx: HandlerCtx, delta: number): void {
  if (delta === 0) return;
  ctx.queryClient.setQueriesData<Counts>({ queryKey: queryKeys.counts(ctx.workspaceId) }, (counts) => adjustCount(counts, delta));
}

/** The event's task, when it is a valid task of this workspace. */
function taskOf(ctx: HandlerCtx, entity: unknown, version: number): Task | null {
  const parsed = TaskSchema.safeParse(entity);
  if (!parsed.success || parsed.data.workspaceId !== ctx.workspaceId) return null;
  return { ...parsed.data, version };
}

/**
 * Writes a newer copy of a task to every cached list: in place when only its text changed, re-placed when
 * it was completed or reopened (it leaves or joins the open rows at its sortOrder), inserted when new.
 * Ignored (false) when a cached copy is at the same or a newer version. Keeps the Inbox count in step.
 */
function applyTask(ctx: HandlerCtx, task: Task): boolean {
  const lists = cachedLists(ctx);
  const cached = findTask(
    lists.map((l) => l.list),
    task.id,
  );
  if (cached && cached.version >= task.version) return false;
  let changed = false;
  for (const { key, list, filter } of lists) {
    if (!list) continue;
    const shape = { includeCompleted: filter.includeCompleted };
    const inList = list.some((item) => item.id === task.id);
    const sameState = inList && list.find((item) => item.id === task.id)!.completedAt === task.completedAt;
    const next = sameState ? updateInCache(list, task, shape) : placeTask(list, task, shape);
    if (next !== list) {
      ctx.queryClient.setQueryData(key, next);
      changed = true;
    }
  }
  const wasOpen = cached ? cached.completedAt === null : false;
  const isOpen = task.completedAt === null;
  if (changed) adjustCounts(ctx, Number(isOpen) - Number(wasOpen));
  return changed;
}

/**
 * task.upserted from someone else: a new task goes in at its sortOrder, an edit replaces the row in place,
 * a completion or reopen moves it between the open and completed rows. Stale versions are ignored.
 */
export function applyTaskUpserted(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'task.upserted' }>): boolean {
  const task = taskOf(ctx, event.entity, event.version);
  return task ? applyTask(ctx, task) : false;
}

/** task.restored (someone's Undo of a delete): the task returns at its sortOrder, unless we already have it at this version. */
export function applyTaskRestored(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'task.restored' }>): boolean {
  const task = taskOf(ctx, event.entity, event.version);
  return task ? applyTask(ctx, task) : false;
}

/** task.deleted: the task leaves every list (and the Inbox count, when it was open). */
export function applyTaskDeleted(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'task.deleted' }>): boolean {
  const lists = cachedLists(ctx);
  const cached = findTask(
    lists.map((l) => l.list),
    event.entity.id,
  );
  if (!cached || cached.version >= event.version) return false;
  for (const { key, list } of lists) {
    const next = removeFromCache(list, event.entity.id);
    if (next !== list) ctx.queryClient.setQueryData(key, next);
  }
  if (cached.completedAt === null) adjustCounts(ctx, -1);
  return true;
}

/**
 * Adds the tasks handlers to story 4's registry (a Set per event type: never replaces another handler).
 * Called once at workspace mount; returns the unregister function.
 */
export function registerTaskLiveHandlers(): () => void {
  const unregister = [
    registerLiveHandler('task.upserted', applyTaskUpserted),
    registerLiveHandler('task.restored', applyTaskRestored),
    registerLiveHandler('task.deleted', applyTaskDeleted),
  ];
  return () => {
    for (const fn of unregister) fn();
  };
}
