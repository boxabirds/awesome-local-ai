/**
 * Per-user undo/redo controller (story 8, undo.history).
 *
 * Wraps Y.UndoManager over the objects map, tracking only LOCAL_ORIGIN
 * transactions so remote changes are never captured. One controller per board
 * doc per tab; history is memory-only and discarded on reload or board change.
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the most recent own change. Returns false when the undo stack is empty. */
  undo(): boolean;
  /** Redo the most recently undone own change. Returns false when the redo stack is empty. */
  redo(): boolean;
  /** Close the current capture window (start a new undo step boundary). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Add a scope type to track (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the controller (history discarded). */
  destroy(): void;
  /** Internal: access the underlying Y.UndoManager for testing. */
  readonly _um: Y.UndoManager;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objectsScope = doc.getMap('objects');

  const um = new Y.UndoManager(objectsScope, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const cb of listeners) cb();
  }

  function trimStack(): void {
    // Trim from the front (oldest) while exceeding maxSteps.
    while (um.undoStack.length > maxSteps) {
      um.undoStack.shift();
    }
  }

  const onStackItemAdded = () => {
    trimStack();
    notify();
  };

  const onStackItemPopped = () => {
    notify();
  };

  um.on('stack-item-added', onStackItemAdded);
  um.on('stack-item-popped', onStackItemPopped);

  let destroyed = false;

  const ctrl: UndoController = {
    undo(): boolean {
      if (destroyed) return false;
      if (um.undoStack.length === 0) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (destroyed) return false;
      if (um.redoStack.length === 0) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      if (destroyed) return;
      um.stopCapturing();
    },
    canUndo(): boolean {
      if (destroyed) return false;
      return um.undoStack.length > 0;
    },
    canRedo(): boolean {
      if (destroyed) return false;
      return um.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      um.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      um.off('stack-item-added', onStackItemAdded);
      um.off('stack-item-popped', onStackItemPopped);
      um.destroy();
      listeners.clear();
    },
    get _um() { return um; },
  };

  return ctrl;
}
