import * as Y from 'yjs';
import { LOCAL_ORIGIN, objectsMap } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/** This tab's personal undo history for one board doc (undo.history). */
export interface UndoController {
  /** Undoes this person's most recent step; false when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the most recently undone step; false when there is nothing to redo. */
  redo(): boolean;
  /** Closes the current capture window: the next local change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Adds another shared type (story 16: comments) to the history. */
  addScope(type: Y.AbstractType<any>): void;
  /** Called whenever canUndo / canRedo may have changed. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Identity of the most recent undo step (null when empty); see `canUndoSince`. */
  checkpoint(): unknown;
  /** Whether a step newer than `checkpoint` is on top of the undo stack (text editor scope). */
  canUndoSince(checkpoint: unknown): boolean;
  /**
   * While held, pauses never split the current step (a drag that stops moving
   * for a while is still one step). Gestures hold between their two boundaries.
   */
  holdCapture(hold: boolean): void;
  destroy(): void;
}

type Stack = Y.UndoManager['undoStack'];

/**
 * Wraps a Y.UndoManager over the board's objects that tracks LOCAL_ORIGIN only:
 * other people's changes (provider origin) and loaded state never enter the stacks.
 */
export function createUndo(doc: Y.Doc, opts: { captureTimeoutMs?: number; maxSteps?: number } = {}): UndoController {
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const scope: Y.AbstractType<any>[] = [objectsMap(doc)];
  // The capture window is timed here rather than by Y.UndoManager, whose clock is
  // bound at import (so it could not follow a test clock). Registered before the
  // manager's own handler, it closes the window when the pause is long enough;
  // the manager then merges everything until the window is closed.
  let lastLocalChange = -Infinity;
  let held = false;
  const timeCapture = (tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN || !scope.some((type) => tr.changedParentTypes.has(type))) return;
    const now = Date.now();
    if (!held && now - lastLocalChange >= captureTimeout) manager.stopCapturing();
    lastLocalChange = now;
  };
  doc.on('afterTransaction', timeCapture);
  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };
  let destroyed = false;

  manager.on('stack-item-added', (event) => {
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  });
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  /**
   * Pops exactly one step. Y.UndoManager keeps popping until something changes;
   * a step whose targets were all deleted by someone else must instead be
   * consumed on its own so the next press does not also undo an older step.
   */
  const popOne = (kind: 'undo' | 'redo'): boolean => {
    if (destroyed) return false;
    const stack: Stack = kind === 'undo' ? manager.undoStack : manager.redoStack;
    const top = stack.at(-1);
    if (!top) return false;
    const rest = stack.slice(0, -1);
    if (kind === 'undo') {
      manager.undoStack = [top];
      try {
        manager.undo();
      } finally {
        manager.undoStack = rest.concat(manager.undoStack);
      }
    } else {
      manager.redoStack = [top];
      try {
        manager.redo();
      } finally {
        manager.redoStack = rest.concat(manager.redoStack);
      }
    }
    notify();
    return true;
  };

  return {
    undo: () => popOne('undo'),
    redo: () => popOne('redo'),
    boundary: () => manager.stopCapturing(),
    canUndo: () => !destroyed && manager.undoStack.length > 0,
    canRedo: () => !destroyed && manager.redoStack.length > 0,
    addScope(type) {
      scope.push(type);
      manager.addToScope(type);
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    checkpoint: () => manager.undoStack.at(-1) ?? null,
    canUndoSince(checkpoint) {
      const top = manager.undoStack.at(-1);
      return !destroyed && top !== undefined && top !== checkpoint;
    },
    holdCapture(hold) {
      held = hold;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('afterTransaction', timeCapture);
      manager.destroy();
      notify();
      listeners.clear();
    },
  };
}
