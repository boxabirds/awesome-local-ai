// Per-person undo history (story 8).
//
// One `UndoController` wraps a `Y.UndoManager` scoped to the board's `objects`
// map and tracking ONLY `LOCAL_ORIGIN` transactions. That single choice is what
// makes undo personal: this tab's own edits carry `LOCAL_ORIGIN` and enter the
// stacks; a colleague's edits arrive through the provider (a different origin)
// and story 4's board-load updates arrive with `LOAD_ORIGIN`, so neither is ever
// captured and undo can never reverse anyone else's work (undo.own).
//
// The manager's own `captureTimeout` groups a run of typing into one step; the
// explicit `boundary()` (its `stopCapturing()`) closes that window so a whole
// drag, resize, delete or colour change is exactly one step and never merges with
// a neighbour. Undo re-applies the inverse as a transaction originated by the
// manager itself (never `LOCAL_ORIGIN`), so it syncs to peers like any change but
// is not itself captured as a new undo step.
//
// The history lives only in memory: `destroy()` disposes the manager, and a fresh
// controller after a reload starts empty (undo.session_only).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * The board's per-person undo history. Every method is safe to call at any time:
 * `undo`/`redo` return `false` when their stack is empty, and `boundary` on an
 * empty history is a no-op. An inverse that targets an object another person has
 * since deleted simply applies nothing and never throws (undo.safe).
 */
export interface UndoController {
  /** Reverse this person's most recent change. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window so the next change is its own step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Widen the tracked scope (story 16 adds the `comments` type here). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to history changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the manager; a fresh controller afterwards starts empty. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst; defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Steps kept before the oldest is dropped; defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

/**
 * Create a per-person undo history over `doc`'s `objects` map. Defaults come from
 * the product settings; tests may pass their own to exercise the boundaries.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap('objects'), {
    // Only this tab's own transactions are captured: remote (provider origin) and
    // story 4 load (`LOAD_ORIGIN`) updates never enter these stacks.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout,
  });

  let destroyed = false;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  // Keep the undo stack to `maxSteps`: when a new step pushes it past the limit,
  // drop the oldest (front) steps (undo.limit). Only the undo stack grows past the
  // limit, so trimming on every added step is correct and cheap.
  const onAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };
  const onPopped = (): void => notify();

  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-popped', onPopped);

  return {
    undo(): boolean {
      if (destroyed) return false;
      return manager.undo() !== null;
    },
    redo(): boolean {
      if (destroyed) return false;
      return manager.redo() !== null;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return !destroyed && manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (!destroyed) manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-popped', onPopped);
      manager.destroy();
      listeners.clear();
    },
  };
}
