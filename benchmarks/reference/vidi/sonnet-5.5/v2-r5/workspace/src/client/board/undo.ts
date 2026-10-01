import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean;                 // false when stack empty
  redo(): boolean;                 // false when stack empty
  boundary(): void;                // close the current capture window
  canUndo(): boolean; canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void; // story 16 adds comments
  onChange(cb: () => void): () => void;
  destroy(): void;
}

/** Per-tab history: only LOCAL_ORIGIN transactions are tracked, so remote and load updates are never undone. */
export function createUndo(
  doc: Y.Doc, opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const { captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS } = opts;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());

  manager.on('stack-item-added', () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  });
  manager.on('stack-item-popped', notify);

  /**
   * Yjs keeps popping steps until one changes something. A step whose target someone else deleted must instead
   * be consumed with no visible effect, so only the newest step is exposed to the manager.
   */
  const popOne = (stack: Y.UndoManager['undoStack'], run: () => void): boolean => {
    if (stack.length === 0) return false;
    const older = stack.splice(0, stack.length - 1);
    try {
      run();
    } finally {
      stack.unshift(...older);
    }
    notify();
    return true;
  };

  return {
    undo: () => popOne(manager.undoStack, () => manager.undo()),
    redo: () => popOne(manager.redoStack, () => manager.redo()),
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy: () => {
      manager.destroy();
      listeners.clear();
    },
  };
}
