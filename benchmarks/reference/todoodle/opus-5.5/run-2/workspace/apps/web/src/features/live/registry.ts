import type { LiveEvent, LiveEventType } from '@todoodle/shared/events';
import type { QueryClient } from '@tanstack/react-query';

export type HandlerCtx = { queryClient: QueryClient; workspaceId: string };

/** 'applied' when the handler changed a cache; 'stale' when the cache already had this version or newer. */
export type HandlerResult = 'applied' | 'stale';

export type LiveHandler<T extends LiveEventType = LiveEventType> = (
  ctx: HandlerCtx,
  event: Extract<LiveEvent, { type: T }>,
) => HandlerResult;

const handlers = new Map<LiveEventType, Set<LiveHandler>>();

/**
 * The single extension point for live events (stories 5 to 8 register here; nobody edits the
 * dispatcher). Several handlers per type all run; registering the same function twice has no
 * extra effect. Returns a function that removes only this handler.
 *
 * Handlers must return 'stale' (and change nothing) when the cached entity's version is at least
 * `event.version`.
 */
export function registerLiveHandler<T extends LiveEventType>(type: T, fn: LiveHandler<T>): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const handler = fn as unknown as LiveHandler;
  set.add(handler);
  return () => {
    const current = handlers.get(type);
    current?.delete(handler);
    if (current?.size === 0) handlers.delete(type);
  };
}

/** The handlers registered for a type (empty when none). */
export function handlersFor(type: LiveEventType): ReadonlySet<LiveHandler> {
  return handlers.get(type) ?? new Set();
}
