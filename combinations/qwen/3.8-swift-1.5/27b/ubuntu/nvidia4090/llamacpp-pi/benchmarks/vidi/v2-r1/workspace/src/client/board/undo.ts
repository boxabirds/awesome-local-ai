import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@shared/config';

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

/**
 * Story 8: per-client undo controller wrapping Y.UndoManager.
 *
 * Only transactions with LOCAL_ORIGIN are tracked, so remote updates
 * (provider origin) and story 4 load updates are never captured in the
 * undo/redo stacks. Each tab has its own independent controller.
 */
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

  const changeListeners = new Set<() => void>();

  function notify() {
    for (const cb of changeListeners) cb();
  }

  // Trim the undo stack to maxSteps on new items.
  const onStackItemAdded = () => {
    while (um.undoStack.length > maxSteps) {
      (um.undoStack as Y.UndoManager['undoStack']).splice(0, 1);
    }
    notify();
  };

  const onStackItemPopped = () => {
    notify();
  };

  um.on('stack-item-added', onStackItemAdded);
  um.on('stack-item-popped', onStackItemPopped);

  return {
    undo(): boolean {
      if (!um.canUndo()) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (!um.canRedo()) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      um.stopCapturing();
    },
    canUndo(): boolean {
      return um.canUndo();
    },
    canRedo(): boolean {
      return um.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      um.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      changeListeners.add(cb);
      return () => {
        changeListeners.delete(cb);
      };
    },
    destroy(): void {
      um.off('stack-item-added', onStackItemAdded);
      um.off('stack-item-popped', onStackItemPopped);
      um.destroy();
      changeListeners.clear();
    },
  };
}
