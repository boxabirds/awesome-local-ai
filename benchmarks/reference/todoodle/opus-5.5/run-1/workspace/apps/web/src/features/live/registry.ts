import type { QueryClient } from '@tanstack/react-query';
import type { LiveEvent, LiveEventType } from '@todoodle/shared/events';

export type HandlerCtx = { queryClient: QueryClient; workspaceId: string };

/**
 * Applies one live event to the query caches. Must drop the event (return false) when the cached
 * entity's version is already at least event.version; returns true when it changed something.
 */
export type LiveHandler<T extends LiveEventType = LiveEventType> = (ctx: HandlerCtx, event: Extract<LiveEvent, { type: T }>) => boolean;

/** Stored type-erased; registerLiveHandler/handlersFor keep the type pairing. */
type AnyHandler = (ctx: HandlerCtx, event: LiveEvent) => boolean;

const handlers = new Map<LiveEventType, Set<AnyHandler>>();

/**
 * The single extension point for live events (architecture §12). Stories 5 to 8 register their
 * handlers here; nobody edits the dispatcher. Several handlers per type all run; registering the same
 * function twice has no extra effect. Returns an unregister function that removes only this handler.
 *
 * @example
 *   useEffect(() => registerLiveHandler('task.upserted', (ctx, e) => upsertTaskInCaches(ctx, e.entity, e.version)), []);
 */
export function registerLiveHandler<T extends LiveEventType>(type: T, fn: LiveHandler<T>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(fn as unknown as AnyHandler);
  return () => {
    handlers.get(type)?.delete(fn as unknown as AnyHandler);
  };
}

/** The handlers registered for a type (a snapshot, so handlers may unregister while running). */
export function handlersFor(type: LiveEventType): AnyHandler[] {
  return [...(handlers.get(type) ?? [])];
}

/** Test helper: forget every handler. */
export function clearLiveHandlersForTests(): void {
  handlers.clear();
}
