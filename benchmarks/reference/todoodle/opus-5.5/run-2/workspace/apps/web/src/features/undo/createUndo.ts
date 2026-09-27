import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';

/** Timers the scheduler uses (injected, so tests drive time). */
export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * counting -> paused (pointer or focus in the toast) -> counting; counting -> expired when the
 * unpaused time reaches the window; counting or paused -> undoing -> undone | failed. `cancelled`:
 * the original change failed, so there is nothing to undo.
 */
export type UndoState = 'counting' | 'paused' | 'undoing' | 'undone' | 'failed' | 'expired' | 'cancelled';

export type UndoHandle = {
  /** Calls the inverse once, if still counting or paused. Resolves when it has settled (never rejects). */
  undo(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Ends the handle without calling the inverse (the original change was rolled back). */
  cancel(): void;
  readonly state: UndoState;
  /** Unpaused time left, in ms. */
  readonly remaining: number;
  /** Called on every state change. */
  subscribe(listener: () => void): () => void;
};

export type UndoOptions = {
  windowMs?: number;
  /** Called once when the handle reaches a final state (expired, undone, failed or cancelled). */
  onSettled?(state: UndoState, error?: unknown): void;
};

const ACTIVE: ReadonlySet<UndoState> = new Set(['counting', 'paused']);

export function isActive(handle: Pick<UndoHandle, 'state'>): boolean {
  return ACTIVE.has(handle.state);
}

/**
 * The undo window of one action: `windowMs` (UNDO_WINDOW_MS) of unpaused time. Paused time does not
 * count; after expiry the inverse is never called; the inverse runs at most once.
 */
export function createUndo(inverse: () => Promise<unknown>, clock: Clock = realClock, opts: UndoOptions = {}): UndoHandle {
  let state: UndoState = 'counting';
  let remaining = opts.windowMs ?? UNDO_WINDOW_MS;
  let startedAt = clock.now();
  let timer: unknown = null;
  const listeners = new Set<() => void>();

  const set = (next: UndoState, error?: unknown) => {
    state = next;
    for (const listener of listeners) listener();
    if (!ACTIVE.has(next) && next !== 'undoing') opts.onSettled?.(next, error);
  };

  const stopTimer = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  const startTimer = () => {
    startedAt = clock.now();
    timer = clock.setTimeout(expire, remaining);
  };

  function expire() {
    timer = null;
    if (state !== 'counting') return;
    remaining = 0;
    set('expired');
  }

  /** Time is checked too, so a late timer can never let an expired undo through. */
  const stillInWindow = () => state === 'paused' || clock.now() - startedAt < remaining;

  startTimer();

  return {
    async undo() {
      if (!ACTIVE.has(state)) return;
      if (!stillInWindow()) {
        stopTimer();
        expire();
        return;
      }
      stopTimer();
      set('undoing');
      try {
        await inverse();
      } catch (error) {
        set('failed', error);
        return;
      }
      set('undone');
    },
    pause() {
      if (state !== 'counting') return;
      stopTimer();
      remaining = Math.max(0, remaining - (clock.now() - startedAt));
      set('paused');
    },
    resume() {
      if (state !== 'paused') return;
      set('counting');
      startTimer();
    },
    cancel() {
      if (!ACTIVE.has(state)) return;
      stopTimer();
      set('cancelled');
    },
    get state() {
      return state;
    },
    get remaining() {
      return state === 'counting' ? Math.max(0, remaining - (clock.now() - startedAt)) : remaining;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
