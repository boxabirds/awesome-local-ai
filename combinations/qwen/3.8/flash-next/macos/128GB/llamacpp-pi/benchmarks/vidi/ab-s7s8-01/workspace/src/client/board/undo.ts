// Undo / redo controller (story 8, board.undo).
//
// One controller per open board tab (the "per person per tab" of PRD
// undo.limit). It wraps `Y.UndoManager` whose `trackedOrigins` is exactly
// `{LOCAL_ORIGIN}`: the stacks therefore contain ONLY transactions this tab
// wrote with the board-model origin. Remote updates — applied by y-websocket
// with the provider as origin, and story 4's load updates with the load
// origin — are never captured, so this tab can never undo them (undo.safe).
//
// The manager scopes the `objects` map, so board-level writes to anything
// else (e.g. story 4's test clock) are not undo steps either.
//
// Step granularity follows Yjs's capture window: transactions written within
// `UNDO_CAPTURE_TIMEOUT_MS` of each other merge into one step. Discrete
// actions (drag start/end, delete, nudge, colour, edit start/end) call
// `boundary()` before and after so a user action is one step regardless of
// sub-second timing; a typing run inside that window merges naturally.
//
// Deleting undo history frees Yjs keep-references, so an undone deletion
// restores the object with the content it had at delete time — including
// remote edits that arrived in between (undo.safe restores, never overwrites:
// reverting an edit a peer has since changed yields the peer's value).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Pop one step from the undo stack. Returns false when the stack is empty.
   * Never throws: an inverse targeting a remotely deleted object has no
   * visible effect (Yjs skips structs whose content is gone) and the manager
   * keeps working afterwards. */
  undo(): boolean;
  /** Push one step back. Returns false when the redo stack is empty. */
  redo(): boolean;
  /** End the current capture window: the next local write opens a NEW step.
   * Call before and after each discrete user action. No-op when nothing has
   * been captured yet (a second boundary can undo nothing extra). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Story 16 adds comment types here; per-object undo needs no scope change. */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called whenever stack contents / emptiness may have changed. Returns an
   * unsubscribe function. */
  onChange(cb: () => void): () => void;
  destroy(): void;
}

export interface UndoOptions {
  /** Override the typing-burst capture window (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** Override the kept-steps cap (default UNDO_MAX_STEPS). */
  maxSteps?: number;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  // trackedOrigins is THE mechanism: only LOCAL_ORIGIN transactions are
  // captured. The manager adds itself to the set (its own inverse
  // transactions must never be re-captured), so pass a fresh Set.
  const manager = new Y.UndoManager(doc.getMap('objects'), {
    captureTimeout: captureTimeoutMs,
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();
  let destroyed = false;
  const notify = () => {
    if (destroyed) return;
    for (const cb of [...listeners]) cb();
  };

  // undo.limit: trim the oldest step whenever the undo stack exceeds the cap.
  // (Freed stack items release their Yjs keep-references.)
  const onItemAdded = (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };
  const onItemPopped = () => notify();
  const onCleared = () => notify();
  const onItemUpdated = () => notify();

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', onItemPopped);
  manager.on('stack-item-updated', onItemUpdated);
  manager.on('stack-cleared', onCleared);

  return {
    undo(): boolean {
      // Yjs's undo skips stack items whose inverse has no effect (e.g. the
      // object was deleted remotely): it discards them within the same call
      // and keeps popping — never throwing, never overwriting. A skipped
      // item emits NO event, so notify manually when the stack shrank even
      // though nothing was undone (`null`), or the buttons would show stale
      // enabled state.
      const before = manager.undoStack.length;
      const done = manager.undo() !== null;
      if (!done && manager.undoStack.length !== before) notify();
      return done;
    },
    redo(): boolean {
      const before = manager.redoStack.length;
      const done = manager.redo() !== null;
      if (!done && manager.redoStack.length !== before) notify();
      return done;
    },
    boundary(): void {
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<unknown>): void {
      manager.addToScope(type as Y.AbstractType<unknown>);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-popped', onItemPopped);
      manager.off('stack-item-updated', onItemUpdated);
      manager.off('stack-cleared', onCleared);
      manager.destroy();
    },
  };
}
