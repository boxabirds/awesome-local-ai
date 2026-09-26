// Per-person undo / redo (contract `undo.history`, story 8).
//
// One `UndoController` wraps a single `Y.UndoManager` for one board document.
// It tracks ONLY this tab's own transactions (`LOCAL_ORIGIN`), so the undo and
// redo stacks hold exclusively this person's changes: a synced peer edit
// (applied with the provider as origin) or a story-4 load update never enters
// these stacks, and undoing can never reverse someone else's work
// (`undo.own`). Each tab has its own controller, so simultaneous editors each
// undo only their own work.
//
// History is session-only: a fresh controller (after a reload or a board
// change) starts empty (`undo.session_only`). The controller owns nothing in
// the document — destroying it leaves the Y.Doc intact.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/** The framework-free undo surface the UI binds to. `undo`/`redo` return
 * false when their stack is empty (nothing was reverted); `boundary` closes
 * the current capture window so the next local change starts a new step. */
export interface UndoController {
  undo(): boolean;
  redo(): boolean;
  /** Close the current capture window (`stopCapturing`). A no-op on empty stacks. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the tracked scope (story 16 adds `comments`). New object types
   * under the objects map need no call — they are already in scope. */
  addScope(type: Y.AbstractType<unknown>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoControllerOptions {
  /** Typing pause that ends a capture window. Defaults to
   * UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Largest number of undo steps kept. Older steps are dropped from the front
   * once the undo stack is longer. Defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
  /** Override the tracked type (component tests scope a throwaway map). */
  scope?: Y.AbstractType<unknown>;
}

/** Create the undo controller for one board document. */
export function createUndo(
  doc: Y.Doc,
  opts: UndoControllerOptions = {},
): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const scope = opts.scope ?? doc.getMap<Y.Map<unknown>>('objects');

  const undoManager = new Y.UndoManager(scope, {
    // Origin filtering, not user filtering: only this tab's own LOCAL_ORIGIN
    // transactions are captured. Remote (provider) and load updates stay out.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of listeners) cb();
  };

  // Keep the undo stack at most `maxSteps` long (`undo.limit`): trim the OLDEST
  // from the front so the newest step is never dropped. Fires alongside every
  // `stack-item-added`; a merged step does not grow the stack, so it is a
  // no-op there.
  const onStackChanged = () => {
    while (undoManager.undoStack.length > maxSteps) {
      undoManager.undoStack.shift();
    }
    emit();
  };

  undoManager.on('stack-item-added', onStackChanged);
  undoManager.on('stack-item-popped', onStackChanged);

  let destroyed = false;

  return {
    undo() {
      if (destroyed) return false;
      return undoManager.undo() != null;
    },
    redo() {
      if (destroyed) return false;
      return undoManager.redo() != null;
    },
    boundary() {
      if (destroyed) return;
      undoManager.stopCapturing();
    },
    canUndo() {
      return !destroyed && undoManager.undoStack.length > 0;
    },
    canRedo() {
      return !destroyed && undoManager.redoStack.length > 0;
    },
    addScope(type) {
      if (!destroyed) undoManager.addToScope(type);
    },
    onChange(cb) {
      if (destroyed) return () => {};
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      undoManager.off('stack-item-added', onStackChanged);
      undoManager.off('stack-item-popped', onStackChanged);
      undoManager.destroy();
      listeners.clear();
    },
  };
}