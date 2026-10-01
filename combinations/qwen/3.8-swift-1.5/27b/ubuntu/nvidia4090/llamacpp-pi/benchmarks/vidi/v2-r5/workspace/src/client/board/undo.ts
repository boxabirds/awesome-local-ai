// src/client/board/undo.ts
// Per-client UndoController over Y.UndoManager (story 8).
//
// Tracks only LOCAL_ORIGIN transactions so that only this tab's own changes
// enter the undo/redo stacks. Remote updates (provider origin) and story 4
// load updates are never captured, so undoing never reverses anyone else's
// work (undo.own). History is session-only: the controller lives in memory
// and is destroyed on board change or unmount (undo.session_only).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the most recent own step. Returns false when the stack is empty. */
  undo(): boolean;
  /** Re-apply the most recently undone own step. Returns false when empty. */
  redo(): boolean;
  /** Close the current capture window (gesture/edit/action boundary). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Add a type to the undo scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack state changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the manager. A fresh controller after reload starts empty. */
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  // Scope is the whole doc so that both object-map changes (create/move/
  // colour/resize/delete) and Y.Text typing are captured. trackedOrigins
  // restricts capture to this tab's own LOCAL_ORIGIN transactions, so remote
  // and load updates never enter the stacks.
  const manager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const cb of [...listeners]) cb();
  };

  const onItemAdded = () => {
    // Trim the undo stack from the front while it exceeds maxSteps (undo.limit)
    const stack = manager.undoStack;
    while (stack.length > maxSteps) {
      stack.shift();
    }
    emit();
  };
  const onItemPopped = () => emit();

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', onItemPopped);

  return {
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => manager.addToScope(type as Y.Map<unknown>),
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-popped', onItemPopped);
      listeners.clear();
      manager.destroy();
    },
  };
}
