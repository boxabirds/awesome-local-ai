import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@shared/config';

export interface UndoController {
  /** Returns true if something was undone; false when stack is empty. */
  undo(): boolean;
  /** Returns true if something was redone; false when stack is empty. */
  redo(): boolean;
  /** Close the current capture window so the next local transaction starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Story 16 will call this to add the comments scope. */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes. Returns unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the undo manager. A fresh controller after reload starts empty. */
  destroy(): void;
  /** Exposed for tests: current undo stack length. */
  undoStackLength(): number;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const scope = doc.getMap('objects');
  const trackedOrigins = new Set<unknown>([LOCAL_ORIGIN]);

  const um = new Y.UndoManager(scope, {
    trackedOrigins,
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();

  const notifyListeners = () => {
    for (const cb of listeners) cb();
  };

  const onStackItemAdded = () => {
    // Trim undo stack to maxSteps (remove oldest from front)
    while (um.undoStack.length > maxSteps) {
      um.undoStack.shift();
    }
    notifyListeners();
  };

  const onStackItemPopped = () => {
    notifyListeners();
  };

  um.on('stack-item-added', onStackItemAdded);
  um.on('stack-item-popped', onStackItemPopped);

  return {
    undo(): boolean {
      const result = um.undo();
      return result != null;
    },
    redo(): boolean {
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
      listeners.clear();
      um.destroy();
    },
    undoStackLength(): number {
      return um.undoStack.length;
    },
  };
}
