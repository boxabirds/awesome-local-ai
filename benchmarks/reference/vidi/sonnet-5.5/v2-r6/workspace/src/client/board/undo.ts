import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean; // false when stack empty
  redo(): boolean; // false when stack empty
  boundary(): void; // close the current capture window
  /** While true, every local change merges into one step (a drag whose frames stall must stay one step). */
  hold?(open: boolean): void;
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void; // story 16 adds comments
  onChange(cb: () => void): () => void;
  destroy(): void;
}

/**
 * Per-tab undo history over the objects map. Only LOCAL_ORIGIN transactions are tracked, so remote
 * and load updates never enter the stacks and undo never reverses anyone else's work.
 */
export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const { captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS } = opts;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());

  manager.on('stack-item-added', () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  });
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  /**
   * Pops exactly one step. Yjs keeps popping until a step changes something, which would silently
   * skip into the next step when this one only touched objects deleted by someone else; hiding the
   * rest of the stack from it keeps "one press = one step".
   */
  const popOne = (stack: Y.UndoManager['undoStack'], run: () => void): boolean => {
    if (stack.length === 0) return false;
    manager.stopCapturing();
    const rest = stack.splice(0, stack.length - 1);
    try {
      run();
    } finally {
      stack.unshift(...rest);
    }
    notify();
    return true;
  };

  return {
    undo: () => popOne(manager.undoStack, () => manager.undo()),
    redo: () => popOne(manager.redoStack, () => manager.redo()),
    boundary: () => manager.stopCapturing(),
    hold: (open) => {
      manager.captureTimeout = open ? Number.MAX_SAFE_INTEGER : captureTimeoutMs;
    },
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy: () => {
      listeners.clear();
      manager.destroy();
    },
  };
}
