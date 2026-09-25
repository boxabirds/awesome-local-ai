// Personal undo history (undo.history). One controller per board doc per tab, memory only.
//
// Only this tab's own transactions (LOCAL_ORIGIN) are captured, so other people's changes (provider origin)
// and the story 4 load never enter the stacks and are never reversed. Undo and redo apply inverse operations
// with the UndoManager as origin; they sync like any other change.
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undoes this person's most recent step. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step. False when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next local change starts a new step. */
  boundary(): void;
  /**
   * Closes the current capture window and keeps the next step open, however long the pauses, until the
   * next `boundary()`. Used by gestures, so a drag held still for a while is still one step.
   */
  beginStep(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Identity of the step on top of the undo (redo) stack, or null when empty. Lets the text editor limit
   *  its own undo to the typing done since editing started. */
  topUndo(): object | null;
  topRedo(): object | null;
  /** Brings another shared type (story 16: comments) under the same history. `any`: a Y.Map or Y.Array is
   *  not assignable to `AbstractType<unknown>` (its event type is invariant). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addScope(type: Y.AbstractType<any>): void;
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export function createUndo(doc: Y.Doc, opts: { captureTimeoutMs?: number; maxSteps?: number } = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  // The capture window is timed here rather than by Y.UndoManager (whose clock is fixed at import), so a
  // step's end is decided by the same clock as the rest of the app. This handler is registered before the
  // UndoManager's, so it runs first for every transaction.
  let lastLocalChange = 0;
  let holding = false;
  const onAfterTransaction = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) return;
    const now = Date.now();
    if (!holding && now - lastLocalChange >= captureTimeout) um.stopCapturing();
    lastLocalChange = now;
  };
  doc.on('afterTransaction', onAfterTransaction);
  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  um.on('stack-item-added', (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo' && um.undoStack.length > maxSteps) {
      um.undoStack.splice(0, um.undoStack.length - maxSteps);
    }
    emit();
  });
  um.on('stack-item-popped', emit);
  um.on('stack-cleared', emit);

  /**
   * Applies exactly one step. Y.UndoManager on its own keeps popping while a step has no effect (its target
   * was deleted by someone else), which would silently undo an older step too; the older steps are hidden
   * while it runs, so a step without effect is simply consumed (undo.safe).
   */
  const step = (stack: Y.UndoManager['undoStack'], run: () => unknown): boolean => {
    if (stack.length === 0) return false;
    const older = stack.splice(0, stack.length - 1);
    try {
      run();
    } finally {
      stack.unshift(...older);
    }
    um.stopCapturing();
    emit();
    return true;
  };

  const boundary = () => {
    holding = false;
    um.stopCapturing();
  };

  return {
    undo: () => step(um.undoStack, () => um.undo()),
    redo: () => step(um.redoStack, () => um.redo()),
    boundary,
    beginStep() {
      boundary();
      holding = true;
    },
    canUndo: () => um.undoStack.length > 0,
    canRedo: () => um.redoStack.length > 0,
    topUndo: () => um.undoStack[um.undoStack.length - 1] ?? null,
    topRedo: () => um.redoStack[um.redoStack.length - 1] ?? null,
    addScope: (type) => um.addToScope(type),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      listeners.clear();
      doc.off('afterTransaction', onAfterTransaction);
      um.clear();
      um.destroy();
    },
  };
}

/** A controller with no history, used before the real one exists. */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary() {},
  beginStep() {},
  canUndo: () => false,
  canRedo: () => false,
  topUndo: () => null,
  topRedo: () => null,
  addScope() {},
  onChange: () => () => {},
  destroy() {},
};
