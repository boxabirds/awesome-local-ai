/**
 * Per-user undo history controller (story 8, undo.history).
 *
 * Wraps Y.UndoManager over the objects map, tracking only LOCAL_ORIGIN
 * transactions so remote changes are never captured. Each participant's tab
 * has its own independent controller; remote updates arrive with the
 * provider origin and never enter these stacks.
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
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objects = doc.getMap('objects');
  const manager = new Y.UndoManager(objects, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const changeListeners: Array<() => void> = [];

  function notifyChange(): void {
    for (const cb of changeListeners) cb();
  }

  function onStackItemAdded(): void {
    // Trim the undo stack from the front while longer than maxSteps.
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notifyChange();
  }

  function onStackItemPopped(): void {
    notifyChange();
  }

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  return {
    undo(): boolean {
      if (manager.undoStack.length === 0) return false;
      manager.undo();
      return true;
    },
    redo(): boolean {
      if (manager.redoStack.length === 0) return false;
      manager.redo();
      return true;
    },
    boundary(): void {
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      manager.scope.push(type);
    },
    onChange(cb: () => void): () => void {
      changeListeners.push(cb);
      return () => {
        const idx = changeListeners.indexOf(cb);
        if (idx >= 0) changeListeners.splice(idx, 1);
      };
    },
    destroy(): void {
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackItemPopped);
      manager.destroy();
    },
  };
}
