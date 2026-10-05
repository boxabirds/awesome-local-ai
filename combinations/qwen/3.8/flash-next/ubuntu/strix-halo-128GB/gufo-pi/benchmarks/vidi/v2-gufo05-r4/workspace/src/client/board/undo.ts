/**
 * Per-person undo history (`undo.own`).
 *
 * A thin controller over `Y.UndoManager` scoped to the board's `objects` map and
 * tracking **only this tab's own transactions** (`LOCAL_ORIGIN`). That origin filter
 * is the whole reason undo is personal and not global: a colleague's change arrives
 * through the network provider with a different origin, so it never enters these
 * stacks and can never be reversed by pressing undo here (`undo.own`, `undo.redo`).
 * There is no shared or server-side history — each person's tab has its own
 * controller over its own document.
 *
 * Two behaviours are added on top of `Y.UndoManager`:
 *  - a length cap (`UNDO_MAX_STEPS`): the oldest step is dropped when a new one would
 *    exceed it (`undo.limit`);
 *  - an `onChange` subscription the React binding listens to so the toolbar buttons
 *    light up and dim with the two stacks.
 *
 * Undoing is safe against a moving world: an inverse whose target another person has
 * deleted simply does nothing rather than throwing or resurrecting content the user
 * never deleted (`undo.safe`). That is `Y.UndoManager`'s own behaviour, which is why
 * we do not fight it.
 */

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverse this person's most recent step. `false` when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone step. `false` when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window so the next change starts a fresh step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bring another shared type under this history (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Call `cb` whenever the undo or redo stacks change; returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Dispose of the manager; a fresh controller afterwards starts empty (session-only). */
  destroy(): void;
}

export interface CreateUndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * A new undo controller for `doc`, scoped to its `objects` map and to this tab's own
 * writes. A step merges with the previous one when they land within
 * `captureTimeoutMs` of each other; {@link UndoController.boundary} ends a merge
 * window early, which is what makes one drag or one edit session exactly one step.
 */
export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeout = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const scope = doc.getMap('objects') as Y.Map<unknown>;
  const manager = new Y.UndoManager(scope, {
    captureTimeout,
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN])
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  // Keep the undo stack at most `maxSteps` deep, dropping the oldest first. New local
  // steps clear redo on their own (UndoManager's default, `undo.redo_cleared`); only
  // the undo stack needs a trim.
  const trimToLimit = () => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onStackItemAdded = (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo') trimToLimit();
    notify();
  };
  const onStackChanged = () => notify();

  manager.on('stack-item-added', onStackItemAdded);
  manager.on('stack-item-popped', onStackChanged);
  manager.on('stack-cleared', onStackChanged);

  return {
    undo(): boolean {
      // `undo()` pops one step and applies its inverse, returning the stack item when a
      // change was made and `null` when the stack was empty or the inverse changed
      // nothing (its target was deleted by someone else). Both cases are "nothing
      // happened here": neither throws, and the rest of the history stays usable
      // (`undo.safe`).
      return manager.undo() !== null;
    },
    redo(): boolean {
      return manager.redo() !== null;
    },
    boundary(): void {
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return manager.canUndo();
    },
    canRedo(): boolean {
      return manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      manager.addToScope([type]);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      manager.off('stack-item-added', onStackItemAdded);
      manager.off('stack-item-popped', onStackChanged);
      manager.off('stack-cleared', onStackChanged);
      manager.destroy();
      listeners.clear();
    }
  };
}
