import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoControllerOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * Creates a per-user undo controller wrapping Y.UndoManager.
 * Only LOCAL_ORIGIN transactions are tracked — remote and load changes are never captured.
 */
export function createUndo(doc: Y.Doc, opts?: UndoControllerOptions): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');

  const um = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners: Set<() => void> = new Set();

  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  const handleStackItemAdded = (): void => {
    // Trim the undo stack to maxSteps
    while (um.undoStack.length > maxSteps) {
      um.undoStack.shift();
    }
    notify();
  };

  const handleStackItemPopped = (): void => {
    notify();
  };

  um.on('stack-item-added', handleStackItemAdded);
  um.on('stack-item-popped', handleStackItemPopped);

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed) return false;
      if (um.undoStack.length === 0) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (destroyed) return false;
      if (um.redoStack.length === 0) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      if (destroyed) return;
      um.stopCapturing();
    },
    canUndo(): boolean {
      if (destroyed) return false;
      return um.undoStack.length > 0;
    },
    canRedo(): boolean {
      if (destroyed) return false;
      return um.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      um.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      um.off('stack-item-added', handleStackItemAdded);
      um.off('stack-item-popped', handleStackItemPopped);
      listeners.clear();
      um.destroy();
    },
  };
}
