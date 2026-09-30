/**
 * Per-user undo/redo controller (story 8).
 *
 * Wraps Y.UndoManager over the objects map, tracking only LOCAL_ORIGIN
 * transactions so remote changes are never captured. Undo applies inverse
 * operations as a new transaction that syncs like any change.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the most recent local step. Returns false when the stack is empty. */
  undo(): boolean;
  /** Redo the most recently undone step. Returns false when the stack is empty. */
  redo(): boolean;
  /** Close the current capture window (stopCapturing). */
  boundary(): void;
  /** Whether there is something to undo. */
  canUndo(): boolean;
  /** Whether there is something to redo. */
  canRedo(): boolean;
  /** Add a tracked scope type (for story 16 comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack state changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the underlying UndoManager. History is discarded. */
  destroy(): void;
}

export interface CreateUndoOpts {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * Create an UndoController for the given Y.Doc.
 *
 * Only transactions made with LOCAL_ORIGIN are tracked; provider and load
 * updates are invisible to undo/redo. One controller per board doc, created
 * in App.tsx and destroyed on board change or unmount.
 */
export function createUndo(doc: Y.Doc, opts?: CreateUndoOpts): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');

  const manager = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();

  const stackItemAdded = (): void => {
    // Trim undo stack to maxSteps
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notifyListeners();
  };

  const stackItemPopped = (): void => {
    notifyListeners();
  };

  manager.on('stack-item-added', stackItemAdded);
  manager.on('stack-item-popped', stackItemPopped);

  function notifyListeners(): void {
    for (const cb of listeners) {
      try {
        cb();
      } catch {
        // Listener errors must not break undo machinery.
      }
    }
  }

  return {
    undo(): boolean {
      if (manager.undoStack.length === 0) return false;
      manager.undo();
      notifyListeners();
      return true;
    },

    redo(): boolean {
      if (manager.redoStack.length === 0) return false;
      manager.redo();
      notifyListeners();
      return true;
    },

    boundary(): void {
      manager.stopCapturing();
    },

    canUndo(): boolean {
      return manager.undoStack.length > 0;
    },

    canRedo(): boolean {
      return manager.redoStack.length > 0;
    },

    addScope(type: Y.AbstractType<unknown>): void {
      (manager as any).addToScope(type);
    },

    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    destroy(): void {
      manager.off('stack-item-added', stackItemAdded);
      manager.off('stack-item-popped', stackItemPopped);
      listeners.clear();
      manager.destroy();
    },
  };
}
