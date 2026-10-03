// Per-client undo controller wrapping Y.UndoManager.
// Tracks only LOCAL_ORIGIN transactions so remote changes are never captured.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the last local step. Returns false if the stack is empty. */
  undo(): boolean;
  /** Redo the last undone step. Returns false if the redo stack is empty. */
  redo(): boolean;
  /** Close the current capture window (start a new step on next change). */
  boundary(): void;
  /** Whether there is a step to undo. */
  canUndo(): boolean;
  /** Whether there is a step to redo. */
  canRedo(): boolean;
  /** Add an additional type to the undo scope (story 16: comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Destroy the controller (frees the UndoManager). */
  destroy(): void;
}

export function createUndo(
  doc: Y.Doc,
  opts?: { captureTimeoutMs?: number; maxSteps?: number },
): UndoController {
  const captureTimeoutMs = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;

  const objects = doc.getMap('objects');
  const um = new Y.UndoManager(objects, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();

  // Trim the undo stack from the front while it exceeds maxSteps.
  um.on('stack-item-added', () => {
    while (um.undoStack.length > maxSteps) {
      um.undoStack.shift();
    }
    for (const cb of listeners) cb();
  });

  um.on('stack-item-popped', () => {
    for (const cb of listeners) cb();
  });

  const controller: UndoController = {
    undo(): boolean {
      if (!um.canUndo()) return false;
      um.undo();
      return true;
    },
    redo(): boolean {
      if (!um.canRedo()) return false;
      um.redo();
      return true;
    },
    boundary(): void {
      um.stopCapturing();
    },
    canUndo(): boolean {
      return um.canUndo();
    },
    canRedo(): boolean {
      return um.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      // Yjs 11 has no public addScope API. The manager is scoped to the
      // objects map which covers all object types. This is a no-op placeholder.
      void type;
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy(): void {
      um.destroy();
      listeners.clear();
    },
  };

  return controller;
}
