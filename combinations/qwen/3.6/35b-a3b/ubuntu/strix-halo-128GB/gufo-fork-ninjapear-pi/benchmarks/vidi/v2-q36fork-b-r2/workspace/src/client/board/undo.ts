import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean;                 // false when stack empty
  redo(): boolean;                 // false when stack empty
  boundary(): void;                // close the current capture window
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void; // story 16 adds comments
  onChange(cb: () => void): () => void;
  destroy(): void;
  readonly undoStackLength: number;
}

interface InternalOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

export function createUndo(
  doc: Y.Doc,
  opts?: InternalOptions,
): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');
  const undoManager = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const subscribers = new Set<() => void>();

  /**
   * Trim the undo stack from the front while longer than maxSteps.
   * Called on every stack-item-added event.
   */
  function trimUndoStack(stack: Y.UndoManager['undoStack']): void {
    while (stack.length > maxSteps) {
      stack.shift();
    }
  }

  const onStackItemAdded = () => {
    // UndoManager's default behavior already clears the redo stack when a new
    // local step is added — we don't need to do anything extra.
    trimUndoStack(undoManager.undoStack);
    for (const cb of subscribers) {
      cb();
    }
  };

  const onStackItemPopped = () => {
    for (const cb of subscribers) {
      cb();
    }
  };

  undoManager.on('stack-item-added', onStackItemAdded);
  undoManager.on('stack-item-popped', onStackItemPopped);

  return {
    undo(): boolean {
      if (!undoManager.canUndo()) {
        return false;
      }
      undoManager.undo();
      return true;
    },

    redo(): boolean {
      if (!undoManager.canRedo()) {
        return false;
      }
      undoManager.redo();
      return true;
    },

    boundary(): void {
      undoManager.stopCapturing();
    },

    canUndo(): boolean {
      return undoManager.undoStack.length > 0;
    },

    canRedo(): boolean {
      return undoManager.redoStack.length > 0;
    },

    addScope(type: Y.AbstractType<unknown>): void {
      undoManager.addToScope(type);
    },

    onChange(cb: () => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    get undoStackLength(): number {
      return undoManager.undoStack.length;
    },

    destroy(): void {
      undoManager.off('stack-item-added', onStackItemAdded);
      undoManager.off('stack-item-popped', onStackItemPopped);
      // Clear stacks so history is discarded (session-only).
      undoManager.clear(true, true);
    },
  };
}
