import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '@/shared/config';

/**
 * Per-user undo history (story 8).
 *
 * A {@link UndoController} wraps a {@link Y.UndoManager} scoped to the board's
 * `objects` map and configured with `trackedOrigins = { LOCAL_ORIGIN }`. Only
 * THIS tab's own transactions (which the board model always opens with
 * `LOCAL_ORIGIN`) enter the undo/redo stacks. Remote updates (provider origin)
 * and load updates (story 4) arrive with a different origin and are never
 * captured, so undo/redo can only ever reverse the local user's own changes
 * (undo.own). Undo applies the inverse operations as a new transaction that
 * syncs to every other client like any other change.
 *
 * Step boundaries: the manager's `captureTimeout` (UNDO_CAPTURE_TIMEOUT_MS)
 * merges transactions that occur within that window into one stack item, which
 * groups a typing burst. {@link UndoController.boundary} (`stopCapturing`)
 * closes the current capture window so that distinct user actions (drag start/
 * end, edit start/end, tool clicks) never merge with their neighbours.
 *
 * The history is session-only: it lives in memory on the controller and is
 * discarded when the controller is destroyed (board change / unmount / reload).
 */
export interface UndoController {
  /** Undo the most recent own step. `false` when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone own step. `false` when none to redo. */
  redo(): boolean;
  /** Close the current capture window so the next change starts a new step. */
  boundary(): void;
  /** True when there is at least one own step to undo. */
  canUndo(): boolean;
  /** True when there is at least one undone own step to re-apply. */
  canRedo(): boolean;
  /** Add another type to the undo scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /**
   * Subscribe to stack-state changes (canUndo/canRedo may have changed).
   * Returns an unsubscribe function.
   */
  onChange(cb: () => void): () => void;
  /** Destroy the controller and release the manager (history is discarded). */
  destroy(): void;
}

export interface CreateUndoOptions {
  /** Typing-pause that ends a burst (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** Max own steps kept in the undo stack (default UNDO_MAX_STEPS). */
  maxSteps?: number;
}

/**
 * Creates an {@link UndoController} over the board doc's `objects` map that
 * tracks only `LOCAL_ORIGIN` transactions (this tab's own changes).
 */
export function createUndo(doc: Y.Doc, opts?: CreateUndoOptions): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  let destroyed = false;

  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // Whenever a stack item is added (to the undo or redo stack) the undo stack
  // may have grown past maxSteps: trim the oldest steps from the front
  // (undo.limit). `stack-item-added` fires both for a new local step (type
  // 'undo') and when a redo re-records an item on the undo stack, so we trim
  // unconditionally — only additions can grow undoStack.
  const onAdded = (): void => {
    while (um.undoStack.length > maxSteps) um.undoStack.shift();
    notify();
  };
  const onPopped = (): void => notify();
  const onCleared = (): void => notify();
  const onUpdated = (): void => notify();

  um.on('stack-item-added', onAdded);
  um.on('stack-item-popped', onPopped);
  um.on('stack-cleared', onCleared);
  um.on('stack-item-updated', onUpdated);

  return {
    undo: () => {
      if (destroyed) return false;
      const item = um.undo();
      return item !== null && item !== undefined;
    },
    redo: () => {
      if (destroyed) return false;
      const item = um.redo();
      return item !== null && item !== undefined;
    },
    boundary: () => {
      if (destroyed) return;
      um.stopCapturing();
    },
    canUndo: () => !destroyed && um.canUndo(),
    canRedo: () => !destroyed && um.canRedo(),
    addScope: (type) => um.addToScope(type),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      um.off('stack-item-added', onAdded);
      um.off('stack-item-popped', onPopped);
      um.off('stack-cleared', onCleared);
      um.off('stack-item-updated', onUpdated);
      listeners.clear();
      um.destroy();
    },
  };
}
