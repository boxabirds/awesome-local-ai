// Per-client undo controller (story 8, undo.history): wraps Y.UndoManager
// over the board's objects map, tracking ONLY LOCAL_ORIGIN transactions, so
// every undo/redo step is strictly this tab's own work. Remote updates
// (provider origin) and story 4 load updates (LOAD origin) never enter the
// stacks and can never be undone (undo.own).
//
// One controller per board doc (created in BoardPage, destroyed on unmount):
// history is session-only and discarded on reload or board change
// (undo.session_only).
//
// Step boundaries: Y.UndoManager's captureTimeout merges transactions
// closer than UNDO_CAPTURE_TIMEOUT_MS into one step (typing bursts);
// `boundary()` (= stopCapturing) forces the next local transaction to start
// a new step (gesture start/end, edit start/end, before/after single
// group operations) so drags and edits never merge with their neighbours
// (undo.boundaries).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverses the most recent own step; false when the undo stack is empty. */
  undo(): boolean;
  /** Re-applies the most recently undone own step; false when empty. */
  redo(): boolean;
  /** Closes the current capture window: the next local change starts a new
   *  step. A no-op when nothing is in flight. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extends the captured scope (story 16 adds the comments type). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribes to stack changes (added/popped); returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Disposes the manager; stacks are gone (undo.session_only). */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing-burst merge window; defaults UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Step capacity; defaults UNDO_MAX_STEPS (trim on add, undo.limit). */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts?: UndoOptions): UndoController {
  const maxSteps = opts?.maxSteps ?? UNDO_MAX_STEPS;
  // trackedOrigins = { LOCAL_ORIGIN } only: this tab's own transactions are
  // the sole input to the stacks. The manager also tracks its own undo/redo
  // transactions (yjs adds itself), which land on the opposite stack.
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: opts?.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS,
  });

  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // Trim the undo stack to maxSteps on add (undo.limit): the OLDEST step is
  // dropped first. yjs pops from the end, so shift() the front.
  const onAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) {
        manager.undoStack.shift();
      }
    }
    emit();
  };
  const onPopped = (): void => {
    emit();
  };
  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-popped', onPopped);

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed) return false;
      // yjs returns null on an empty stack; a no-op item (its target was
      // deleted remotely) is consumed by yjs without effect and never
      // throws (undo.safe).
      return manager.undo() != null;
    },
    redo(): boolean {
      if (destroyed) return false;
      return manager.redo() != null;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.canUndo();
    },
    canRedo(): boolean {
      return !destroyed && manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (!destroyed) manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-popped', onPopped);
      manager.destroy();
      listeners.clear();
    },
  };
}
