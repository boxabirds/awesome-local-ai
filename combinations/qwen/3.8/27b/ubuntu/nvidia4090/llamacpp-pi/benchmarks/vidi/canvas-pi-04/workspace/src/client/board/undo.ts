// Story 8: per-client undo controller (anchor: undo.history).
//
// Wraps Y.UndoManager over the board's objects map, tracking only this
// client's LOCAL_ORIGIN transactions. Yjs' trackedOrigins filter does the
// core work: a colleague's changes arrive with the sync provider's origin
// (story 3), so they are never captured into this client's undo/redo stack
// and undo/redo never reverses them (undo.own). Undo transactions carry the
// UndoManager's own origin, which the manager adds to its tracked set, so
// the inverse of each undo lands on the redo stack (Yjs semantics) instead
// of being captured as a new "undo of the undo" step.
//
// History is memory only: a fresh controller (after a reload, a board
// switch, or a room restart) starts empty (undo.session_only).
//
// Step structure (undo.steps): local changes within UNDO_CAPTURE_TIMEOUT_MS
// of each other merge into one step (a typing burst); boundary() forces a
// step break before/after discrete actions (a gesture, a delete, a colour
// change). A full multi-object delete is one transaction, hence one step.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the last own step. Returns false when there is nothing to undo. */
  undo(): boolean;
  /** Redo the last undone own step. Returns false when there is nothing to redo. */
  redo(): boolean;
  /**
   * Close the current capture window: the next local change starts a new
   * step even if it happens within the capture timeout. A no-op when no
   * step is open.
   */
  boundary(): void;
  /** Whether an undo is currently possible. */
  canUndo(): boolean;
  /** Whether a redo is currently possible. */
  canRedo(): boolean;
  /**
   * Extend the tracked scope with more top-level types (story 16 adds the
   * comments map). Not needed by story 8, whose scope is objects only.
   */
  addScope(type: Y.AbstractType<unknown>): void;
  /**
   * Subscribe to any stack change (step added, popped, updated or cleared);
   * returns an unsubscribe function. The UI re-reads canUndo/canRedo from
   * this event.
   */
  onChange(cb: () => void): () => void;
  /** Detach from the doc. The controller must not be used afterwards. */
  destroy(): void;
}

export interface UndoOptions {
  /** Merge window in ms; defaults to UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Maximum steps kept per stack; defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
}

/**
 * Create the per-board undo controller for `doc`.
 *
 * Must be created per board doc and destroyed when the doc goes away
 * (board switch / unmount); see TC-11 (reload = fresh controller).
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const um = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  // Enforce the step limit: when a new undo step lands, drop the oldest
  // until the stack is back at maxSteps (design decision 4, undo.limit).
  // Redo steps are bounded by construction: redoing pops a redo item and
  // pushes a corresponding undo item, so the undo stack never exceeds its
  // limit while redo is growing.
  um.on('stack-item-added', (event) => {
    if (event.type === 'undo') {
      while (um.undoStack.length > maxSteps) {
        um.undoStack.shift();
      }
    }
  });

  return {
    undo: (): boolean => um.undo() !== null,
    redo: (): boolean => um.redo() !== null,
    boundary: (): void => {
      um.stopCapturing();
    },
    canUndo: (): boolean => um.canUndo(),
    canRedo: (): boolean => um.canRedo(),
    addScope: (type: Y.AbstractType<unknown>): void => {
      um.addToScope(type);
    },
    onChange: (cb: () => void): (() => void) => {
      um.on('stack-item-added', cb);
      um.on('stack-item-updated', cb);
      um.on('stack-item-popped', cb);
      um.on('stack-cleared', cb);
      return (): void => {
        um.off('stack-item-added', cb);
        um.off('stack-item-updated', cb);
        um.off('stack-item-popped', cb);
        um.off('stack-cleared', cb);
      };
    },
    destroy: (): void => {
      um.destroy();
    },
  };
}
