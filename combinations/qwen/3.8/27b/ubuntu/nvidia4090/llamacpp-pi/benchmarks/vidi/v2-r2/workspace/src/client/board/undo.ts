/**
 * Per-user undo/redo controller (story 8, undo.*).
 *
 * One UndoController per client, wrapping a Y.UndoManager scoped to the
 * objects map. It tracks ONLY LOCAL_ORIGIN transactions, so each person's
 * history contains exactly their own changes: remote updates (provider
 * origin) and story 4's load updates never enter the stack (undo.own).
 *
 * Steps:
 * - undo() / redo() apply the inverse as a fresh transaction that syncs to
 *   peers like any other change; the inverse is never captured back into
 *   this person's stack. Inverses that target an object a colleague deleted
 *   in the meantime simply have no effect there — no exception, no crash
 *   (undo.safe).
 * - typing bursts merge via the capture timeout (UNDO_CAPTURE_TIMEOUT_MS);
 *   boundary() (stopCapturing) closes the window at gesture and text-edit
 *   start/end so one user action is one step (undo.steps, undo.typing).
 * - the undo stack is trimmed to UNDO_MAX_STEPS, dropping the oldest steps
 *   (undo.limit).
 *
 * History is session-only: it lives in this client's memory and is dropped
 * on reload or when the board changes (undo.session_only).
 */
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Undo the last local step; true when a change was applied. */
  undo(): boolean;
  /** Redo the last undone local step; true when a change was applied. */
  redo(): boolean;
  /** Close the current capture window (gesture / text-edit start and end). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the scope (story 16 adds comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to canUndo/canRedo changes; returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoOptions {
  /** Pause that ends a typing burst (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** Most recent steps kept (default UNDO_MAX_STEPS). */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts?: UndoOptions): UndoController {
  const captureTimeout = opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) {
      cb();
    }
  };

  // 'stack-item-added' / 'stack-item-popped' cover every change of the
  // stack lengths; 'stack-cleared' covers the silent redo-stack clear that
  // happens when a new local change invalidates the redo stack. Merges
  // ('stack-item-updated') do not change canUndo/canRedo and are ignored.
  const onStackItemAdded = (): void => {
    // undo.limit: keep at most maxSteps steps, dropping the oldest.
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
    notify();
  };
  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  const controller: UndoController = {
    undo: (): boolean => manager.undo() !== null,
    redo: (): boolean => manager.redo() !== null,
    boundary: (): void => manager.stopCapturing(),
    canUndo: (): boolean => manager.undoStack.length > 0,
    canRedo: (): boolean => manager.redoStack.length > 0,
    addScope: (type: Y.AbstractType<unknown>): void => {
      manager.addToScope(type as Y.AbstractType<Y.Map<unknown>>);
    },
    onChange: (cb: () => void): (() => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: (): void => manager.destroy(),
  };
  return controller;
}
