// Per-user undo/redo controller (see spec: undo.history).
//
// Wraps Y.UndoManager over the board's objects map with
// `trackedOrigins: { LOCAL_ORIGIN }`: only THIS tab's own transactions enter
// the undo/redo stacks. Remote changes (y-websocket provider origin) and
// story 4 load updates (a different origin) are never captured, so undoing
// never reverses anyone else's work (undo.own). Each participant's tab owns
// its own independent controller; history is in-memory only and dies with
// the controller (page reload / board change, undo.session_only).
//
// Step boundaries: Y.UndoManager merges transactions into one stack item
// while they are < captureTimeout (UNDO_CAPTURE_TIMEOUT_MS) apart, which
// groups typing bursts and rAF drag frames. Explicit `boundary()`
// (stopCapturing) calls at gesture start/end and edit start/end keep
// separate user actions apart (undo.boundaries, undo.steps).
//
// Safety: inverses targeting objects deleted by a peer apply nothing in Yjs
// (undo.safe); the step is consumed and the rest of the history stays usable.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo this user's last step; false when the stack is empty. */
  undo(): boolean;
  /** Redo this user's last undone step; false when the stack is empty. */
  redo(): boolean;
  /** Close the current capture window so the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the captured scope (story 16 adds the comments map). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes; returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Release the manager (history is gone; a new controller starts empty). */
  destroy(): void;
}

export interface CreateUndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  const onStackItemAdded = (): void => {
    // Trim from the front (oldest first) to UNDO_MAX_STEPS (undo.limit).
    const stack = manager.undoStack;
    while (stack.length > maxSteps) stack.shift();
    emit();
  };

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-updated', emit);
  manager.on('stack-item-popped', emit);

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
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-updated', emit);
      manager.off('stack-item-popped', emit);
      listeners.clear();
      manager.destroy();
    },
  };
}
