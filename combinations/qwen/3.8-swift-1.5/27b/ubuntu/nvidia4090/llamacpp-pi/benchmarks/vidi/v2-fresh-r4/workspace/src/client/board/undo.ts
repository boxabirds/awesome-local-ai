import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * Per-user undo history over a board doc.
 *
 * Only transactions made with LOCAL_ORIGIN (this tab's own changes) are
 * captured, so remote updates (provider origin) and story 4 load updates
 * are never undone (undo.own). History is session-only: it lives in
 * memory and is discarded when the controller is destroyed (reload or
 * board change).
 */
export interface UndoController {
  /** Undo the user's most recent step. Returns false when the stack is empty. */
  undo(): boolean;
  /** Re-apply the user's most recently undone step. Returns false when empty. */
  redo(): boolean;
  /** Close the current capture window so the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Add another type to the undo scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack state changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the controller and drop the history. */
  destroy(): void;
}

export interface CreateUndoOpts {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * Create a per-user UndoController over the board's objects map.
 */
export function createUndo(doc: Y.Doc, opts?: CreateUndoOpts): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  // Trim the undo stack to maxSteps, dropping the oldest step (undo.limit).
  const onItemAdded = (): void => {
    const stack = manager.undoStack;
    while (stack.length > maxSteps) {
      stack.splice(0, 1);
    }
    notify();
  };
  const onItemPopped = (): void => notify();
  const onCleared = (): void => notify();

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', onItemPopped);
  manager.on('stack-cleared', onCleared);

  return {
    undo(): boolean {
      if (manager.undoStack.length === 0) return false;
      const lenBefore = manager.undoStack.length;
      const redoLenBefore = manager.redoStack.length;
      manager.undo();
      const consumed = lenBefore - manager.undoStack.length;
      if (consumed > 1 && manager.redoStack.length > redoLenBefore) {
        // Yjs's pop loop absorbs no-op steps (e.g. the target was deleted
        // remotely) and keeps popping until a step applies a visible change.
        // Re-apply that older step so exactly one step is consumed per undo:
        // nothing visible happens for the deleted target, and the re-applied
        // change is captured as a new step so the rest of the history stays
        // usable (undo.safe).
        manager.redo();
      }
      return true;
    },
    redo(): boolean {
      if (manager.redoStack.length === 0) return false;
      return manager.redo() !== null;
    },
    boundary(): void {
      manager.stopCapturing();
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
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-popped', onItemPopped);
      manager.off('stack-cleared', onCleared);
      manager.destroy();
      listeners.clear();
    },
  };
}
