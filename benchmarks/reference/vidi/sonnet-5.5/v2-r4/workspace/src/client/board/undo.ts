import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  undo(): boolean; // false when stack empty
  redo(): boolean; // false when stack empty
  boundary(): void; // close the current capture window
  canUndo(): boolean;
  canRedo(): boolean;
  addScope(type: Y.AbstractType<unknown>): void; // story 16 adds comments
  onChange(cb: () => void): () => void;
  destroy(): void;
}

/** Per-tab history over the objects map; only LOCAL_ORIGIN transactions are captured, so other people's changes never enter it. */
export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const { captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS } = opts;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    // Burst grouping is done below with our own clock; Yjs' timer is bound to the real clock at import time.
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  let lastLocalAt = 0;
  const onBefore = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    const now = Date.now();
    if (lastLocalAt > 0 && now - lastLocalAt >= captureTimeoutMs) manager.stopCapturing();
    lastLocalAt = now;
  };
  doc.on('beforeTransaction', onBefore);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());

  manager.on('stack-item-added', () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  });
  manager.on('stack-item-updated', notify);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  const run = (op: () => unknown): boolean => {
    try {
      return op() != null;
    } catch {
      return false;
    }
  };

  return {
    undo: () => run(() => manager.undo()),
    redo: () => run(() => manager.redo()),
    boundary: () => {
      lastLocalAt = 0;
      manager.stopCapturing();
    },
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    addScope: (type) => manager.addToScope(type),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      listeners.clear();
      doc.off('beforeTransaction', onBefore);
      manager.destroy();
    },
  };
}

/** Inert controller used before the real one exists. */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => {},
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => {},
  onChange: () => () => {},
  destroy: () => {},
};
