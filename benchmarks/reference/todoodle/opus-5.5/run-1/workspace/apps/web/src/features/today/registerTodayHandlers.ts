import { TODAY_INVALIDATE_DEBOUNCE_MS } from '@todoodle/shared/limits';
import type { LiveEvent, LiveEventType } from '@todoodle/shared/events';
import type { Counts } from '@todoodle/shared/schemas';
import { type HandlerCtx, registerLiveHandler } from '@/features/live/registry';
import { findTask } from '@/features/tasks/cacheOps';
import type { LocalTask } from '@/features/tasks/taskCache';
import { queryKeys } from '@/lib/queryKeys';
import { findInTodayCaches } from './todayCache';

/** Events that can change what Today shows: task edits (dates!), deletes, restores, bulk changes, projects. */
export const TODAY_EVENT_TYPES = [
  'task.upserted',
  'task.deleted',
  'task.restored',
  'tasks.bulk',
  'project.deleted',
  'project.restored',
  // A renamed or recoloured project changes the tags on Today's rows.
  'project.upserted',
] as const satisfies readonly LiveEventType[];

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * The copy of a task this tab had before the event: any Today first (only refetched later), then any list. These
 * handlers are registered before story 5's (AppShell), so the lists still hold the old copy too.
 */
function cachedTask(ctx: HandlerCtx, id: string): LocalTask | undefined {
  const lists = ctx.queryClient.getQueriesData<LocalTask[]>({ queryKey: queryKeys.tasks(ctx.workspaceId) }).map(([, list]) => list);
  return findInTodayCaches(ctx.queryClient, ctx.workspaceId, id) ?? findTask(lists, id);
}

/**
 * Whether the event may change the Today count, which the story 5/7 count handlers do not track: a dated task
 * changed, or one that was dated (as cached here) changed or went; project deletes and restores take their tasks
 * along. tasks.bulk already refetches counts (story 4). Undated tasks never touch it.
 */
function mayChangeTodayCount(ctx: HandlerCtx, event: LiveEvent): boolean {
  switch (event.type) {
    case 'task.upserted':
    case 'task.restored':
      return (event.entity as { dueDate?: unknown }).dueDate != null || cachedTask(ctx, event.entity.id)?.dueDate != null;
    case 'task.deleted':
      return cachedTask(ctx, event.entity.id)?.dueDate != null;
    case 'project.deleted':
    case 'project.restored':
      return true;
    default:
      return false;
  }
}

/**
 * Someone else changed something Today may show: refetch every cached Today of the workspace (and the counts, when
 * the Today count may have moved), at most once per TODAY_INVALIDATE_DEBOUNCE_MS: a burst of events costs one
 * request each. Nothing to do (false) when neither is affected. The dispatcher has already dropped this tab's own
 * echoes, so our own changes never refetch.
 */
export function invalidateTodaySoon(ctx: HandlerCtx, event: LiveEvent): boolean {
  const prefix = queryKeys.today(ctx.workspaceId);
  const todayCached = ctx.queryClient.getQueryCache().findAll({ queryKey: prefix }).length > 0;
  const countsKey = queryKeys.counts(ctx.workspaceId);
  const countsHaveToday = ctx.queryClient.getQueryData<Counts>(countsKey)?.today !== undefined;
  const refreshCounts = countsHaveToday && mayChangeTodayCount(ctx, event);
  if (!todayCached && !refreshCounts) return false;
  if (refreshCounts) scheduled.counts.add(ctx.workspaceId);
  if (todayCached) scheduled.today.add(ctx.workspaceId);
  if (timers.has(ctx.workspaceId)) return true;
  timers.set(
    ctx.workspaceId,
    setTimeout(() => {
      timers.delete(ctx.workspaceId);
      if (scheduled.today.delete(ctx.workspaceId)) void ctx.queryClient.invalidateQueries({ queryKey: prefix });
      if (scheduled.counts.delete(ctx.workspaceId)) void ctx.queryClient.invalidateQueries({ queryKey: countsKey }, { cancelRefetch: false });
    }, TODAY_INVALIDATE_DEBOUNCE_MS),
  );
  return true;
}

const scheduled = { today: new Set<string>(), counts: new Set<string>() };

/**
 * Adds Today's handlers to story 4's registry (a set per event type: other stories' handlers keep running).
 * Called once per workspace mount; returns the unregister function.
 */
export function registerTodayHandlers(): () => void {
  const unregister = TODAY_EVENT_TYPES.map((type) => registerLiveHandler(type, invalidateTodaySoon));
  return () => {
    for (const fn of unregister) fn();
  };
}

/** Test helper: drop pending refetches. */
export function clearTodayHandlerTimersForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  scheduled.today.clear();
  scheduled.counts.clear();
}
