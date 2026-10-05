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

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');
  const um = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  let destroyed = false;
  const changeListeners = new Set<() => void>();

  function notifyChange(): void {
    for (const cb of [...changeListeners]) cb();
  }

  // Trim the undo stack to maxSteps on every stack-item-added
  const onStackItemAdded = () => {
    if (destroyed) return;
    const stack = um.undoStack;
    while (stack.length > maxSteps) {
      stack.shift();
    }
    notifyChange();
  };

  const onStackItemPopped = () => {
    if (destroyed) return;
    notifyChange();
  };

  um.on('stack-item-added', onStackItemAdded);
  um.on('stack-item-popped', onStackItemPopped);

  return {
    undo(): boolean {
      if (destroyed || !um.canUndo()) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (destroyed || !um.canRedo()) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      if (destroyed) return;
      um.stopCapturing();
    },
    canUndo(): boolean {
      if (destroyed) return false;
      return um.canUndo();
    },
    canRedo(): boolean {
      if (destroyed) return false;
      return um.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      um.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      changeListeners.add(cb);
      return () => {
        changeListeners.delete(cb);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      um.off('stack-item-added', onStackItemAdded);
      um.off('stack-item-popped', onStackItemPopped);
      um.destroy();
      changeListeners.clear();
    },
  };
}
