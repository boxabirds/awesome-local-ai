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
  isDestroyed(): boolean;
}

/** Per-tab history: only LOCAL_ORIGIN transactions are tracked, so other people's changes are never undone. */
export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const { captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS, maxSteps = UNDO_MAX_STEPS } = opts;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    // Merging is decided below with Date.now() (not Yjs's own captured clock), so the manager merges until told to stop.
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  const listeners = new Set<() => void>();
  let destroyed = false;
  let lastLocalAt = 0;
  const onBeforeTransaction = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    const now = Date.now();
    if (lastLocalAt > 0 && now - lastLocalAt >= captureTimeoutMs) manager.stopCapturing();
    lastLocalAt = now;
  };
  doc.on('beforeTransaction', onBeforeTransaction);
  const notify = () => listeners.forEach((cb) => cb());

  manager.on('stack-item-added', () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  });
  manager.on('stack-item-updated', notify);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  return {
    undo() {
      if (destroyed || manager.undoStack.length === 0) return false;
      manager.stopCapturing();
      manager.undo();
      return true;
    },
    redo() {
      if (destroyed || manager.redoStack.length === 0) return false;
      manager.stopCapturing();
      manager.redo();
      return true;
    },
    boundary: () => manager.stopCapturing(),
    canUndo: () => !destroyed && manager.undoStack.length > 0,
    canRedo: () => !destroyed && manager.redoStack.length > 0,
    addScope: (type) => manager.addToScope(type),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('beforeTransaction', onBeforeTransaction);
      manager.destroy();
      listeners.clear();
    },
    isDestroyed: () => destroyed,
  };
}
