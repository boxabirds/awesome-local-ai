import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@shared/config';

/** Controller that wraps a Y.UndoManager for per-user undo/redo of board objects. */
export interface UndoController {
  /** Apply the inverse of the last own step. Returns false if stack is empty. */
  undo(): boolean;
  /** Re-apply the most recently undone step. Returns false if stack is empty. */
  redo(): boolean;
  /** Close the current capture window so the next transaction starts a new step. */
  boundary(): void;
  /** Whether there is at least one step to undo. */
  canUndo(): boolean;
  /** Whether there is at least one step to redo. */
  canRedo(): boolean;
  /** Add an additional scope (type) to observe — used by story 16 for comments. */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to changes in stack state. Returns unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose of the undo manager and clean up all listeners. */
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const subscribers = new Set<() => void>();

  // Fire onChange to observers whenever stack state changes
  function notify() {
    for (const cb of subscribers) {
      try {
        cb();
      } catch {
        /* subscriber errors — don't break */
      }
    }
  }

  // Trim undo stack from the front (oldest) when it exceeds maxSteps.
  // undoStack is a YArray subclass that has standard Array methods including shift().
  function trimUndo() {
    const uStack = um.undoStack as { length: number; shift(): unknown };
    while (uStack.length > maxSteps) {
      uStack.shift();
    }
  }

  const addedHandler = () => {
    trimUndo();
    notify();
  };
  const poppedHandler = notify;

  um.on('stack-item-added', addedHandler);
  um.on('stack-item-popped', poppedHandler);

  return {
    undo(): boolean {
      if (um.undoStack.length === 0) return false;
      um.undo();
      return true;
    },

    redo(): boolean {
      if (um.redoStack.length === 0) return false;
      um.redo();
      return true;
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
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    destroy(): void {
      um.off('stack-item-added', addedHandler);
      um.off('stack-item-popped', poppedHandler);
      subscribers.clear();
      um.destroy();
    },
  };
}
