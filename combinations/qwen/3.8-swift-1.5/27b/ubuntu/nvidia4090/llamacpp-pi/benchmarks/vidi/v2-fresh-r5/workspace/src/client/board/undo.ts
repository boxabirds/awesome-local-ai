/**
 * Per-client undo controller (story 8). Wraps a `Y.UndoManager` scoped to the
 * board's objects map, tracking only LOCAL_ORIGIN transactions, so each
 * person's undo/redo history contains exclusively their own changes
 * (undo.own). Remote updates (provider origin) and load updates are never
 * captured and are therefore never reversed.
 *
 * History is session-only: the controller lives in memory and is destroyed
 * on board change or unmount (undo.session_only).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * Per-user undo/redo controller for one board doc.
 */
export interface UndoController {
  /** Undo the last own step. Returns false when the undo stack is empty. */
  undo(): boolean;
  /** Redo the last undone own step. Returns false when the redo stack is empty. */
  redo(): boolean;
  /**
   * Close the current capture window so the next local change starts a new
   * undo step. No-op when nothing is being captured.
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Add another type to the tracked scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes (canUndo/canRedo may have changed). Returns unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Destroy the controller and release resources. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst. Default UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Maximum number of undo steps kept. Default UNDO_MAX_STEPS. */
  maxSteps?: number;
}

/**
 * Create the per-user undo controller for a board doc.
 */
export function createUndo(doc: Y.Doc, opts?: UndoOptions): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objects = doc.getMap('objects');
  const manager = new Y.UndoManager(objects, {
    // Only this tab's own transactions are captured (undo.own). Undo/redo
    // inverses are applied with the manager's own origin and are not
    // re-captured, which is what makes redo work.
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // Trim the undo stack from the front while it exceeds maxSteps (undo.limit).
  const onItemAdded = (): void => {
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.splice(0, 1);
    }
    notify();
  };

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', notify);
  manager.on('stack-item-updated', notify);
  manager.on('stack-cleared', notify);

  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => manager.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      manager.destroy();
      listeners.clear();
    },
  };
}
