/**
 * Per-person undo history for one board document (story 8).
 *
 * An `UndoController` is one person's history on one screen: it wraps `Y.UndoManager` over the
 * `objects` map and tracks *this tab's own transactions only* (`trackedOrigins: LOCAL_ORIGIN`).
 * Everything that arrives from the room - a colleague's change, or story 4's load updates - comes
 * in with a different origin, so it never enters these stacks and can never be reversed here.
 * Undo therefore applies the inverse of one own step as an ordinary change, which syncs to
 * everybody exactly like a fresh edit.
 *
 * Steps are made meaningful by boundaries: `boundary()` closes the current capture window, so the
 * next change starts a new step. Gestures and text editing call it at their start and end, which
 * leaves the capture timeout (`captureTimeoutMs`) to do the one job it is good at - merging a
 * burst of typing into a single step.
 *
 * The history lives in memory only: a fresh controller (a reload, or another board) starts empty.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverses this person's most recent step. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next change is a new step. Never fails. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds another root type to the history's scope (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribes to stack changes; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Stops observing the document. The history is gone with it. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a step. Defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Steps kept before the oldest falls off. Defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  // `trackedOrigins` is the whole of the personal scope: this tab writes with LOCAL_ORIGIN,
  // the provider writes with its own origin, and story 4's load writes with LOAD_ORIGIN.
  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const onStackChange = (): void => {
    // undo.limit: the newest steps survive, the oldest fall off the front.
    if (manager.undoStack.length > maxSteps) {
      manager.undoStack.splice(0, manager.undoStack.length - maxSteps);
    }
    notify();
  };

  manager.on('stack-item-added', onStackChange);
  manager.on('stack-item-popped', onStackChange);

  let destroyed = false;

  return {
    undo: () => !destroyed && manager.undo() !== null,
    redo: () => !destroyed && manager.redo() !== null,
    boundary: () => {
      if (!destroyed) manager.stopCapturing();
    },
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope: (type) => {
      if (!destroyed) manager.addToScope(type);
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      manager.off('stack-item-added', onStackChange);
      manager.off('stack-item-popped', onStackChange);
      manager.destroy();
    },
  };
}
