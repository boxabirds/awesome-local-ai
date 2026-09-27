import { LiveEvent } from '@todoodle/shared/events';
import { queryKeys } from '@/lib/queryKeys';
import { clientId as thisClientId } from './clientId';
import { type HandlerCtx, handlersFor } from './registry';

export type DispatchCtx = HandlerCtx & {
  /** The edit-guard registry (live.conflict_notice). */
  editGuard?: { notify(event: LiveEvent): void };
  announcer?: { record(event: LiveEvent): void };
  /** Overridable for tests; defaults to this tab's id. */
  clientId?: string;
};

export type DispatchOutcome = 'malformed' | 'echo' | 'invalidated' | 'applied' | 'stale';

/**
 * Applies one incoming frame (already JSON-parsed). Malformed frames are ignored with a warning;
 * our own echoes are ignored (the optimistic update already applied them); types nobody handles
 * refetch the workspace; otherwise every handler runs, and an applied change is passed to the
 * edit guards and the screen-reader announcer.
 */
export function dispatchEvent(ctx: DispatchCtx, frame: unknown): DispatchOutcome {
  const parsed = LiveEvent.safeParse(frame);
  if (!parsed.success) {
    console.warn('Ignoring a malformed live event');
    return 'malformed';
  }
  const event = parsed.data;
  if (event.originClientId !== null && event.originClientId === (ctx.clientId ?? thisClientId)) return 'echo';

  const handlers = handlersFor(event.type);
  if (handlers.size === 0) {
    void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.root(ctx.workspaceId) });
    return 'invalidated';
  }
  let applied = false;
  for (const handler of handlers) {
    if (handler(ctx, event as never) === 'applied') applied = true;
  }
  if (!applied) return 'stale';
  ctx.editGuard?.notify(event);
  ctx.announcer?.record(event);
  return 'applied';
}
