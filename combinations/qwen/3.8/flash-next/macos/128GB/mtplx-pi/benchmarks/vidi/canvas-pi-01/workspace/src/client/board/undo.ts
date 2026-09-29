/**
 * Story 8 · task 2 — the per-person undo history controller (design
 * "Per-user undo history").
 *
 * `createUndo` wraps a `Y.UndoManager` over the board's `objects` map and tracks
 * ONLY this tab's `LOCAL_ORIGIN` transactions. That single choice is what makes
 * undo personal: a colleague's change arrives with the provider as its origin and
 * a story-4 board load is applied under the load origin, so neither ever enters
 * these stacks (PRD undo.own). Undo/redo therefore invert *this person's* own
 * steps and leave everyone else's work intact.
 *
 * Steps are grouped by explicit **boundaries** rather than the wall clock alone.
 * The underlying `Y.UndoManager` merges local transactions that land within its
 * own `captureTimeout`, but that timer reads a module-level `Date.now` a test
 * fake clock cannot reach — so the controller drives its OWN capture window
 * through an injectable clock instead:
 *
 *   • `boundary()` (a tool, a delete, a colour change, or a whole drag gesture
 *     that calls it at start and end) closes the window so the next change starts
 *     a fresh step;
 *   • `typingEdit()` marks a text change and merges it into the running burst
 *     only while the gap since the previous keystroke is under `captureTimeoutMs`;
 *     a longer pause (or `boundary()` at edit end) opens the next step.
 *
 * Undo is safe by construction: an inverse whose target an unselected peer
 * deleted mid-flight finds nothing to re-apply, produces no change and throws no
 * error, and the rest of the history stays usable (PRD undo.safe).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/** The personal-history surface the rest of the client talks to. */
export interface UndoController {
  /** Reverse the last own step. `false` when the undo stack is empty. */
  undo(): boolean;
  /** Re-apply the last undone step. `false` when the redo stack is empty. */
  redo(): boolean;
  /**
   * Close the current capture window so the next own change starts a fresh step.
   * A no-op on an empty history. Called at every gesture / edit / toolbar edge.
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the tracked scope (story 16 adds `comments` here). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Run `fn` isolated from the steps before and after it (its own step). */
  step<T>(fn: () => T): T;
  /**
   * Mark a text change: continues the current typing burst (merged into one
   * step) while gaps stay under `captureTimeoutMs`, otherwise opens a new step.
   */
  typingEdit(): void;
  /** Subscribe to stack changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Tear down all listeners (a fresh controller after reload starts empty). */
  destroy(): void;
  /** Diagnostic/test hook: current undo-stack length. */
  undoDepth(): number;
}

export interface UndoOptions {
  /** Typing-pause length that ends a burst (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** History length before the oldest step is dropped (default UNDO_MAX_STEPS). */
  maxSteps?: number;
  /** Injectable time source (defaults to `Date.now`); used by `typingEdit`. */
  clock?: () => number;
}

/**
 * Build a controller over `doc`'s `objects` map — one per board doc, destroyed
 * on board change / unmount (the history is session-only).
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const clock = opts.clock ?? ((): number => Date.now());

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  // A single tracked origin: this tab's own edits. The provider and the
  // story-4 load path use other origins, so their updates never become undo
  // steps (undo.own). UndoManager mutates the set it is handed, so give it a
  // private one. `captureTimeout` stays at the named setting for the real app;
  // the controller's own window (below) is what tests drive.
  const manager = new Y.UndoManager(objects, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  // The controller's own capture window, keyed on the injectable clock. `started`
  // says whether a burst is in progress; `lastChange` is when it last saw a
  // change. Closing calls `stopCapturing()` so the manager also stops merging,
  // keeping controller and manager in agreement.
  const window = { started: false, lastChange: 0 };
  const closeWindow = (): void => {
    window.started = false;
    window.lastChange = 0;
    manager.stopCapturing();
  };

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  // Keep the personal history at most `maxSteps` long by dropping the oldest
  // (front) entries as new ones arrive (undo.limit). Fires per added step.
  const onStackChanged = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  };

  manager.on('stack-item-added', onStackChanged);
  manager.on('stack-item-popped', onStackChanged);

  const controller: UndoController = {
    undo(): boolean {
      closeWindow();
      // A step below the one we pop should stay separate, so start clean.
      const popped = manager.undo();
      // `popStackItem` returns the last StackItem only when it actually changed
      // something, otherwise null. A step whose target a peer deleted mid-flight
      // yields null: no change, no error, but the rest of the history stays usable
      // (undo.safe). Truthiness distinguishes "applied" from "nothing to do".
      return popped != null;
    },
    redo(): boolean {
      closeWindow();
      const popped = manager.redo();
      return popped != null;
    },
    boundary(): void {
      closeWindow();
    },
    canUndo(): boolean {
      return manager.canUndo();
    },
    canRedo(): boolean {
      return manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      manager.addToScope(type);
    },
    step<T>(fn: () => T): T {
      closeWindow();
      try {
        return fn();
      } finally {
        closeWindow();
      }
    },
    typingEdit(): void {
      const now = clock();
      if (window.started && now - window.lastChange >= captureTimeoutMs) {
        // A pause of at least the capture timeout ends the burst.
        manager.stopCapturing();
      }
      window.started = true;
      window.lastChange = now;
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      listeners.clear();
      manager.destroy();
    },
    undoDepth(): number {
      return manager.undoStack.length;
    },
  };

  return controller;
}