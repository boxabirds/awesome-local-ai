import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@/shared/config';

/** Controller wrapping Y.UndoManager for per-user undo history. */
export interface UndoController {
  /** Undo one step; returns false when stack is empty. */
  undo(): boolean;
  /** Redo one step; returns false when stack is empty. */
  redo(): boolean;
  /** Close the current capture window (one step boundary). */
  boundary(): void;
  /** Returns true if undo is available. */
  canUndo(): boolean;
  /** Returns true if redo is available. */
  canRedo(): boolean;
  /** Add a Y.AbstractType to the UndoManager scope (story 16). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Destroy the controller, disposing the manager. */
  destroy(): void;
}

type ChangeHandler = () => void;

/**
 * Create an UndoController over the given Y.Doc.
 * Tracks only transactions with LOCAL_ORIGIN so remote updates are never undone.
 */
export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  // Create UndoManager over the objects map, tracking only local-origin transactions
  const undoManager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const changeHandlers = new Set<ChangeHandler>();

  const trimUndoStack = (): void => {
    const undoArray = (undoManager as any).undoStack;
    if (Array.isArray(undoArray)) {
      while (undoArray.length > maxSteps) {
        undoArray.shift();
      }
    }
  };

  // Listen to stack-item-added: trim the undo stack when it exceeds maxSteps
  undoManager.on('stack-item-added', () => {
    trimUndoStack();
    for (const handler of changeHandlers) {
      handler();
    }
  });

  // Listen to stack-item-popped for redo operations
  undoManager.on('stack-item-popped', () => {
    for (const handler of changeHandlers) {
      handler();
    }
  });

  return {
    undo(): boolean {
      const result = (undoManager as any).undo();
      return result !== null && result !== undefined;
    },

    redo(): boolean {
      const result = (undoManager as any).redo();
      return result !== null && result !== undefined;
    },

    boundary(): void {
      undoManager.stopCapturing();
    },

    canUndo(): boolean {
      const undoArray = (undoManager as any).undoStack;
      return Array.isArray(undoArray) && undoArray.length > 0;
    },

    canRedo(): boolean {
      const redoArray = (undoManager as any).redoStack;
      return Array.isArray(redoArray) && redoArray.length > 0;
    },

    addScope(type: Y.AbstractType<unknown>): void {
      undoManager.addToScope(type);
    },

    onChange(cb: ChangeHandler): () => void {
      changeHandlers.add(cb);
      return () => {
        changeHandlers.delete(cb);
      };
    },

    destroy(): void {
      undoManager.destroy();
      changeHandlers.clear();
    },
  };
}
