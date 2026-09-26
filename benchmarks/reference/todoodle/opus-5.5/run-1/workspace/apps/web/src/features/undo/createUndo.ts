import { UNDO_WINDOW_MS } from '@todoodle/shared/limits';

/** Timer access, injected so tests control time. */
export type Clock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** Looked up at call time, so fake timers installed by tests apply. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * counting -> paused (hovered or focused) -> counting; counting -> expired when the unpaused time reaches
 * the window; counting or paused -> undoing -> undone | failed.
 */
export type UndoState = 'counting' | 'paused' | 'undoing' | 'undone' | 'failed' | 'expired';

export type UndoHandle = {
  /** Calls the inverse once, if the window is still open. Resolves when it settled (never rejects). */
  undo(): Promise<void>;
  pause(): void;
  resume(): void;
  readonly state: UndoState;
  /** Unpaused time left, in ms (0 once the window is over). */
  readonly remaining: number;
};

/** True while Undo is still on offer (the toast shows and Cmd/Ctrl+Z may pick it). */
export function isActive(state: UndoState): boolean {
  return state === 'counting' || state === 'paused';
}

/**
 * One undoable action's window (ui.undo): UNDO_WINDOW_MS of UNPAUSED time. Paused time never counts. After
 * the window `inverse` is never called; within it, undo() calls it exactly once. `onChange` hears every
 * state change (the toast uses it to dismiss itself and report the outcome).
 */
export function createUndo(
  inverse: () => Promise<unknown>,
  clock: Clock = realClock,
  onChange?: (state: UndoState) => void,
  windowMs: number = UNDO_WINDOW_MS,
): UndoHandle {
  let state: UndoState = 'counting';
  let remaining = windowMs;
  let startedAt = clock.now();
  let timer: unknown = clock.setTimeout(expire, remaining);

  function set(next: UndoState): void {
    state = next;
    onChange?.(next);
  }

  function stopTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function expire(): void {
    timer = null;
    if (state !== 'counting') return;
    remaining = 0;
    set('expired');
  }

  /** The window may have run out between timer ticks: settle it before acting. */
  function settleClock(): void {
    if (state === 'counting' && clock.now() - startedAt >= remaining) {
      stopTimer();
      expire();
    }
  }

  return {
    get state() {
      settleClock();
      return state;
    },
    get remaining() {
      if (state === 'counting') return Math.max(0, remaining - (clock.now() - startedAt));
      return state === 'paused' ? remaining : 0;
    },
    pause() {
      settleClock();
      if (state !== 'counting') return;
      stopTimer();
      remaining -= clock.now() - startedAt;
      set('paused');
    },
    resume() {
      if (state !== 'paused') return;
      startedAt = clock.now();
      timer = clock.setTimeout(expire, remaining);
      set('counting');
    },
    async undo() {
      settleClock();
      if (!isActive(state)) return;
      stopTimer();
      set('undoing');
      try {
        await inverse();
      } catch {
        set('failed');
        return;
      }
      set('undone');
    },
  };
}
