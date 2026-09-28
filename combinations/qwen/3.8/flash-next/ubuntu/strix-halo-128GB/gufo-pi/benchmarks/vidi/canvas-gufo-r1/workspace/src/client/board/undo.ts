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
 * Creates a per-tab undo/redo controller over a Y.Doc.
 * Only LOCAL_ORIGIN transactions are captured; remote and load-origin updates are ignored.
 */
export function createUndo(doc: Y.Doc, opts?: UndoControllerOptions): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');

  const manager = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();

  function notifyListeners(): void {
    for (const cb of listeners) cb();
  }

  function onStackChange(): void {
    // Trim undo stack to maxSteps
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notifyListeners();
  }

  manager.on('stack-item-added', onStackChange);
  manager.on('stack-item-popped', onStackChange);
  manager.on('stack-cleared', onStackChange);

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed) return false;
      if (manager.undoStack.length === 0) return false;
      manager.undo();
      return true;
    },
    redo(): boolean {
      if (destroyed) return false;
      if (manager.redoStack.length === 0) return false;
      manager.redo();
      return true;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      if (destroyed) return false;
      return manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      if (destroyed) return false;
      return manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      (manager as any).addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onStackChange);
      manager.off('stack-item-popped', onStackChange);
      manager.off('stack-cleared', onStackChange);
      listeners.clear();
      manager.destroy();
    },
  };
}
