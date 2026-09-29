// Per-tab undo history (story 8). Only this tab's own transactions (LOCAL_ORIGIN) are
// captured, so other people's changes (provider origin) and loaded content are never undone.
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverses this person's most recent step. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds another shared type to the history (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called whenever canUndo/canRedo may have changed. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  opts: { captureTimeoutMs?: number; maxSteps?: number } = {},
): UndoController {
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  // The capture window is timed here with Date.now() (Yjs keeps its own reference to the clock,
  // which fake clocks in tests cannot reach): Yjs merges every local transaction into the open
  // step, and a pause of captureTimeoutMs closes it before the next one starts.
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });
  let lastLocalChange = -Infinity;
  const beforeTransaction = (tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN && Date.now() - lastLocalChange >= captureTimeoutMs) {
      manager.stopCapturing();
    }
  };
  const afterTransaction = (tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN) lastLocalChange = Date.now();
  };
  doc.on('beforeTransaction', beforeTransaction);
  doc.on('afterTransaction', afterTransaction);
  const listeners = new Set<() => void>();
  let destroyed = false;
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };

  manager.on('stack-item-added', ({ type }) => {
    if (type === 'undo' && manager.undoStack.length > maxSteps) {
      manager.undoStack.splice(0, manager.undoStack.length - maxSteps);
    }
    notify();
  });
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  /**
   * Y.UndoManager skips steps that no longer change anything (e.g. a move of an object someone
   * else deleted) and carries on with the next one. Here such a step is consumed on its own, so
   * one press never reverses more than one step.
   */
  const pop = (kind: 'undo' | 'redo'): boolean => {
    if (destroyed) return false;
    const key = kind === 'undo' ? 'undoStack' : 'redoStack';
    const stack = manager[key];
    if (stack.length === 0) return false;
    const rest = stack.slice(0, -1);
    manager[key] = stack.slice(-1);
    try {
      if (kind === 'undo') manager.undo();
      else manager.redo();
    } finally {
      manager[key] = rest.concat(manager[key]);
    }
    notify();
    return true;
  };

  return {
    undo: () => pop('undo'),
    redo: () => pop('redo'),
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
      doc.off('beforeTransaction', beforeTransaction);
      doc.off('afterTransaction', afterTransaction);
      manager.destroy();
      notify();
      listeners.clear();
    },
  };
}
