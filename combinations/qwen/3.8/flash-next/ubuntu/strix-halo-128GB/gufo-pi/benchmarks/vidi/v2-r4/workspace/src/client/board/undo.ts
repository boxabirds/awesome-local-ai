/**
 * Per-user undo/redo controller wrapping Y.UndoManager.
 *
 * Tracks only LOCAL_ORIGIN transactions so remote (provider) and load-origin
 * changes are never captured. Each tab creates one controller per board doc;
 * history is session-only (discarded on reload or board change).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the most recent own step. Returns false when the undo stack is empty. */
  undo(): boolean;
  /** Redo the most recently undone step. Returns false when the redo stack is empty. */
  redo(): boolean;
  /** Close the current capture window so the next local step is separate. */
  boundary(): void;
  /** Whether there is something to undo. */
  canUndo(): boolean;
  /** Whether there is something to redo. */
  canRedo(): boolean;
  /** Add an additional Y type to the tracked scope (story 16 comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the controller and free resources. */
  destroy(): void;
}

export interface UndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts?: UndoOptions): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const scope = doc.getMap('objects');
  const trackedOrigins = new Set<unknown>([LOCAL_ORIGIN]);

  const um = new Y.UndoManager(scope, {
    trackedOrigins,
    captureTimeout,
  });

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const cb of listeners) cb();
  }

  function trimStack(): void {
    while (um.undoStack.length > maxSteps) {
      um.undoStack.shift();
    }
  }

  const onStackItemAdded = (): void => {
    trimStack();
    notify();
  };

  const onStackItemPopped = (): void => {
    notify();
  };

  um.on('stack-item-added', onStackItemAdded);
  um.on('stack-item-popped', onStackItemPopped);
  um.on('stack-cleared', notify);
  um.on('stack-item-updated', notify);

  return {
    undo(): boolean {
      if (um.undoStack.length === 0) return false;
      const result = um.undo();
      return result != null;
    },

    redo(): boolean {
      if (um.redoStack.length === 0) return false;
      const result = um.redo();
      return result != null;
    },

    boundary(): void {
      um.stopCapturing();
    },

    canUndo(): boolean {
      return um.undoStack.length > 0;
    },

    canRedo(): boolean {
      return um.redoStack.length > 0;
    },

    addScope(type: Y.AbstractType<unknown>): void {
      um.addToScope(type);
    },

    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    destroy(): void {
      um.off('stack-item-added', onStackItemAdded);
      um.off('stack-item-popped', onStackItemPopped);
      um.off('stack-cleared', notify);
      um.off('stack-item-updated', notify);
      listeners.clear();
      um.destroy();
    },
  };
}
