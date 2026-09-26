import type { LiveEvent } from '@todoodle/shared/events';
import { type Counts, TaskSchema } from '@todoodle/shared/schemas';
import { type HandlerCtx, registerLiveHandler } from '@/features/live/registry';
import { queryKeys } from '@/lib/queryKeys';
import { type LocalTask, adjustCount, applyTaskEvents } from './taskCache';

/**
 * task.upserted from someone else: applied to the Inbox list with applyTaskEvents (a newer version
 * replaces the row in place, an older or equal one is ignored, a new task goes in at its sortOrder), and
 * a new task raises the Inbox count. Returns false when nothing changed (the dispatcher's "stale").
 */
export function applyTaskUpserted(ctx: HandlerCtx, event: Extract<LiveEvent, { type: 'task.upserted' }>): boolean {
  const parsed = TaskSchema.safeParse(event.entity);
  if (!parsed.success || parsed.data.workspaceId !== ctx.workspaceId) return false;
  const key = queryKeys.tasks(ctx.workspaceId, { list: 'inbox' });
  const before = ctx.queryClient.getQueryData<LocalTask[]>(key);
  const after = applyTaskEvents(before, [{ entity: parsed.data, version: event.version }]);
  if (!after || after === before) return false;
  ctx.queryClient.setQueryData(key, after);
  if (after.length > (before?.length ?? 0)) {
    ctx.queryClient.setQueriesData<Counts>({ queryKey: queryKeys.counts(ctx.workspaceId) }, (counts) => adjustCount(counts, 1));
  }
  return true;
}

/**
 * Adds the tasks handlers to story 4's registry (a Set per event type: never replaces another handler).
 * Called once at workspace mount; returns the unregister function.
 */
export function registerTaskLiveHandlers(): () => void {
  return registerLiveHandler('task.upserted', applyTaskUpserted);
}
