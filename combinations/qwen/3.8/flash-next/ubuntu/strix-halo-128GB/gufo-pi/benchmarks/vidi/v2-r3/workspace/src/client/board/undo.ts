/**
 * Per-user undo controller (story 8).
 *
 * Wraps Y.UndoManager over the objects map, tracking only LOCAL_ORIGIN
 * transactions so remote changes are never captured. Undo/redo stacks are
 * per-tab, memory-only, and discarded on reload or board change.
 */
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
  /** Test-only: exposes the underlying UndoManager for timing manipulation. */
  readonly _manager: Y.UndoManager;
}

export interface CreateUndoOpts {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts?: CreateUndoOpts): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const scope = doc.getMap('objects');
  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();

  function notify() {
    for (const cb of listeners) cb();
  }

  function onStackItemAdded() {
    // Trim the undo stack from the front while longer than maxSteps
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notify();
  }

  function onStackItemPopped() {
    notify();
  }

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  let destroyed = false;

  return {
    _manager: manager,

    undo(): boolean {
      if (destroyed) return false;
      if (!manager.canUndo()) return false;
      const item = manager.undo();
      return item !== null;
    },

    redo(): boolean {
      if (destroyed) return false;
      if (!manager.canRedo()) return false;
      const item = manager.redo();
      return item !== null;
    },

    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },

    canUndo(): boolean {
      if (destroyed) return false;
      return manager.canUndo();
    },

    canRedo(): boolean {
      if (destroyed) return false;
      return manager.canRedo();
    },

    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      manager.addToScope(type);
    },

    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackItemPopped);
      manager.destroy();
      listeners.clear();
    },
  };
}
