/**
 * Story 8: per-person undo history over the shared board document.
 *
 * The whole of undo lives here. A `Y.UndoManager` watches the `objects` map and
 * captures only transactions made by *this tab* (`LOCAL_ORIGIN`): everything a
 * colleague does arrives through the sync provider with a different origin, so
 * it never enters these stacks and can never be reversed here. Undo therefore
 * reverses exactly one person's own last action and leaves everyone else's work
 * standing on every screen.
 *
 * One controller belongs to one board document and lives only in this tab's
 * memory: it is created when a board is opened and destroyed when the board is
 * left, so a reload (or another device) starts with an empty history
 * (PRD undo.session_only).
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverse this person's most recent change. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window so the next change is its own step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Add a shared type to the undo scope (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called whenever the undo/redo stacks change. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Stop watching the document. A fresh controller afterwards starts empty. */
  destroy(): void;
}

export interface CreateUndoOptions {
  /** Typing pause that ends a burst; defaults to {@link UNDO_CAPTURE_TIMEOUT_MS}. */
  captureTimeoutMs?: number;
  /** History length; defaults to {@link UNDO_MAX_STEPS}. */
  maxSteps?: number;
}

/**
 * Wrap a `Y.UndoManager` over the objects map, tracking only local transactions.
 *
 * Errors are never thrown to callers: an empty stack reports `false`, and an
 * inverse that targets an object a colleague has since deleted simply has no
 * effect (Yjs drops it), leaving the rest of the history usable
 * (PRD undo.safe).
 */
export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    // Only this tab's own transactions are captured. Remote updates (the sync
    // provider's origin) and a board's load updates are never undone here, so a
    // colleague's work is never reversed (PRD undo.own). The UndoManager adds
    // its own origin to this set, which is how its undo/redo transactions land
    // on the opposite stack rather than being re-captured as new steps.
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const onStackItemAdded = (event: { type: 'undo' | 'redo' }) => {
    // Trim only the undo stack; the redo stack can never grow past what the undo
    // stack held, which is itself bounded here (PRD undo.limit).
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };
  const onStackItemPopped = () => notify();

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackItemPopped);

  return {
    undo() {
      const applied = manager.undo();
      // Notify unconditionally: an inverse that targets an object a colleague
      // deleted consumes its step without emitting a pop, and the buttons must
      // still learn that the stack changed.
      notify();
      return applied != null;
    },
    redo() {
      const applied = manager.redo();
      notify();
      return applied != null;
    },
    boundary() {
      manager.stopCapturing();
    },
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope(type: Y.AbstractType<unknown>) {
      manager.addToScope(type);
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackItemPopped);
      listeners.clear();
      manager.destroy();
    },
  };
}
