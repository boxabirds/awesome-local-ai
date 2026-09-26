import { LiveEvent } from '@todoodle/shared/events';
import { queryKeys } from '@/lib/queryKeys';
import { type Announcer, announcer } from './announcer';
import { clientId } from './clientId';
import { notifyEditGuards } from './editGuard';
import { type HandlerCtx, handlersFor } from './registry';

export type DispatchDeps = {
  /** This tab's id: events it caused are echoes, already applied optimistically. */
  clientId: string;
  announcer: Pick<Announcer, 'record'>;
  /** Tells open editors about someone else's change (live.conflict_notice). */
  notifyGuards(event: LiveEvent): void;
};

export type DispatchOutcome = 'invalid' | 'echo' | 'invalidated' | 'stale' | 'applied';

const defaultDeps: DispatchDeps = { clientId, announcer, notifyGuards: notifyEditGuards };

/**
 * Applies one incoming frame (already JSON-parsed): malformed frames are ignored with a warning, our
 * own echoes are ignored, types without handlers invalidate the whole workspace, and otherwise every
 * handler runs. Only an event some handler applied reaches the edit guards and the announcer.
 */
export function dispatchEvent(ctx: HandlerCtx, frame: unknown, deps: DispatchDeps = defaultDeps): DispatchOutcome {
  const parsed = LiveEvent.safeParse(frame);
  if (!parsed.success) {
    console.warn('Ignored a malformed live event');
    return 'invalid';
  }
  const event = parsed.data;
  if (event.originClientId === deps.clientId) return 'echo';
  const handlers = handlersFor(event.type);
  if (handlers.length === 0) {
    void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.root(ctx.workspaceId) });
    return 'invalidated';
  }
  let applied = false;
  for (const handler of handlers) {
    if (handler(ctx, event)) applied = true;
  }
  if (!applied) return 'stale';
  deps.notifyGuards(event);
  deps.announcer.record();
  return 'applied';
}

/** Test hook: the default dependencies, with overrides. */
export function dispatchDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return { ...defaultDeps, ...overrides };
}
