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

/**
 * Creates a per-client UndoController over the board's objects map.
 *
 * Only LOCAL_ORIGIN transactions are tracked, so remote updates (provider
 * origin) and load updates are never captured. Undo/redo apply inverse
 * operations as new transactions that sync like any other change.
 *
 * - `boundary()` closes the current capture window (stopCapturing).
 * - `captureTimeoutMs` merges transactions within the timeout (typing bursts).
 * - `maxSteps` trims the undo stack from the front when exceeded.
 * - `destroy()` disposes the manager; a fresh controller starts empty.
 */
export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number }
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsMap = doc.getMap('objects');
  const um = new Y.UndoManager(objectsMap, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();

  const notify = () => {
    for (const cb of listeners) cb();
  };

  const onStackChange = () => {
    // Trim the undo stack from the front while longer than maxSteps.
    const stack = um.undoStack;
    while (stack.length > maxSteps) {
      stack.shift();
    }
    notify();
  };

  um.on('stack-item-added', onStackChange);
  um.on('stack-item-popped', onStackChange);

  return {
    undo() {
      return um.undo() !== null;
    },
    redo() {
      return um.redo() !== null;
    },
    boundary() {
      um.stopCapturing();
    },
    canUndo() {
      return um.canUndo();
    },
    canRedo() {
      return um.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>) {
      um.addToScope(type);
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      um.off('stack-item-added', onStackChange);
      um.off('stack-item-popped', onStackChange);
      um.destroy();
      listeners.clear();
    },
  };
}
