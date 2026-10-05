import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * One person's undo history for one board (story 8).
 *
 * The history belongs to *this tab*: `Y.UndoManager` is created with
 * `trackedOrigins = new Set([LOCAL_ORIGIN])`, so only the transactions this tab
 * performs through the board model enter its stacks. Colleague's changes arrive
 * through the provider (origin: the provider) and story 4's load through the
 * sync protocol (origin: the provider / `null`), so neither is ever captured,
 * neither now nor when new object types arrive in stories 9–12.
 *
 * Undoing applies the inverse as a new transaction whose origin is the
 * `UndoManager` itself (yjs adds it to the tracked origins so the step lands on
 * the redo stack). That transaction is an ordinary document update, so every
 * other screen converges on the same board.
 */
export interface UndoController {
  /** Reverse this tab's most recent step. `false` when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone step. `false` when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window: the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Add another shared type to the history (story 16 adds `comments`).
   *
   * `Y.AbstractType<any>` rather than `<unknown>` because yjs declares its event
   * handlers invariantly: a concrete `Y.Map<unknown>` is not assignable to
   * `Y.AbstractType<unknown>`, and this is the same type yjs's own
   * `UndoManager.addToScope` accepts.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addScope(type: Y.AbstractType<any>): void;
  /** Subscribe to stack changes; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Stop observing the document. A fresh controller afterwards starts empty. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst of merged transactions. */
  captureTimeoutMs?: number;
  /** Oldest steps beyond this are dropped from the undo stack. */
  maxSteps?: number;
}

/**
 * Observe the objects map of `doc` and keep this tab's changes in undo and redo
 * stacks.
 *
 * A new local step clears the redo stack (UndoManager's default,
 * `undo.redo_cleared`), a step whose target a colleague deleted has no effect
 * and consumes the step (`undo.safe` — yjs never recreates content the user did
 * not delete), and the undo stack is trimmed to `maxSteps` from the front
 * (`undo.limit`).
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = Math.max(1, opts.maxSteps ?? UNDO_MAX_STEPS);

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const manager = new Y.UndoManager(objects, {
    captureTimeout,
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /**
   * Drop the oldest steps. The trimmed item's content may then be garbage
   * collected, which is exactly what "the oldest step is gone" means: the
   * history is a fixed-size window over this session, not an archive.
   */
  const trim = () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onAdded = () => {
    trim();
    notify();
  };
  const onPopped = () => notify();
  const onCleared = () => notify();

  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-popped', onPopped);
  manager.on('stack-cleared', onCleared);

  /**
   * `undo()` / `redo()` return the stack item only when the inverse actually
   * changed something; a step whose object a colleague deleted is consumed
   * silently. The stack moving is therefore what "a step was used" means here —
   * the caller only ever uses the answer to decide whether anything happened.
   */
  const step = (direction: 'undo' | 'redo'): boolean => {
    const stack = direction === 'undo' ? manager.undoStack : manager.redoStack;
    const before = stack.length;
    if (before === 0) return false;
    try {
      if (direction === 'undo') manager.undo();
      else manager.redo();
    } catch {
      // Undo must never break on changed objects (`undo.safe`); the step is
      // spent and the rest of the history stays usable.
    } finally {
      // yjs discards a step whose content is no longer there — my move of a note
      // a colleague deleted — and when it finds nothing at all left to change it
      // fires no event. The stacks moved either way, so this is where listeners
      // (and the toolbar) learn the truth.
      notify();
    }
    return before !== stack.length;
  };

  return {
    undo: () => step('undo'),
    redo: () => step('redo'),
    // `stopCapturing()` closes the window without touching the stacks, so it is
    // a no-op when there is nothing to group.
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
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-popped', onPopped);
      manager.off('stack-cleared', onCleared);
      listeners.clear();
      manager.destroy();
    },
  };
}
