// Per-person undo history over the board document (story 8, undo.history).
//
// There is one controller per board document per tab, wrapping a Y.UndoManager
// that tracks ONLY this tab's own transactions (`LOCAL_ORIGIN`, which every
// mutation in `shared/board-model` carries). Everything that arrives from
// another person arrives through the provider, whose origin is not this one, so
// it is never captured and can never be reversed from here: five people on one
// board each have a history of their own, in their own tab, and nobody's Undo
// reaches anybody else's work.
//
// The history is in memory only. A reload, a board change or an unmount destroys
// the controller and with it everything it remembered (undo.session_only).
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * The undo and redo history of one person on one board, in this tab only.
 *
 * `undo()` and `redo()` reverse (or re-apply) that person's most recent change
 * by applying its inverse as a new local transaction, which syncs to everybody
 * like any other change. An inverse whose target another person has since
 * deleted applies nothing and is simply consumed: nothing is thrown and no
 * content this person did not delete is ever recreated (undo.safe).
 */
export interface UndoController {
  /** Reverse this person's most recent change. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is nothing to redo. */
  redo(): boolean;
  /** Close the current capture window, so the next change starts its own step. */
  boundary(): void;
  /** Is there anything to undo? */
  canUndo(): boolean;
  /** Is there anything to redo? */
  canRedo(): boolean;
  /** Add a type to the history's scope (story 16 adds the comments map). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Hear about every change of the two stacks. Returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Stop observing the document and throw the history away (undo.session_only). */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst; defaults to UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Steps kept; defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
}

/** What a new step is measured against: the objects map, for now. Story 16 adds
 * the comments map through `addScope`, and stories 9–12 need no new undo code at
 * all because their objects live in the same map. */
const SCOPE = 'objects';

/**
 * Create the undo controller of one board document: a `Y.UndoManager` over its
 * objects map that follows this tab's own transactions and nothing else.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap(SCOPE), {
    // Origin filtering, not user filtering: this tab's writes alone are
    // captured, so remote updates (the provider's origin) and story 4's load
    // updates never enter either stack. The manager adds its own origin here,
    // which is how its own undo and redo transactions land on the far stack.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  let destroyed = false;

  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  /**
   * A history holds UNDO_MAX_STEPS steps: when a new one arrives at the limit,
   * the oldest one at the front of the undo stack is thrown away (undo.limit).
   * Only the undo stack is trimmed — the redo stack only ever holds what an
   * undo press put there, and it is cleared by any new change anyway.
   */
  const onStackChanged = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  };

  manager.on('stack-item-added', onStackChanged);
  manager.on('stack-item-popped', notify);
  manager.on('stack-item-updated', notify);
  manager.on('stack-cleared', notify);

  return {
    undo(): boolean {
      if (destroyed) return false;
      // Yjs consumes the popped item and, with it, any older step whose own
      // items another person has already deleted: such a step has nothing to
      // put back, applies nothing, and never jams the history (undo.safe).
      return manager.undo() !== null;
    },
    redo(): boolean {
      if (destroyed) return false;
      return manager.redo() !== null;
    },
    boundary(): void {
      if (destroyed) return;
      // Closes the capture window, so a drag, a resize or a colour change is
      // never merged with what came before or after it. On an empty history it
      // does nothing at all.
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.canUndo();
    },
    canRedo(): boolean {
      return !destroyed && manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (destroyed) return;
      // The cast is a yjs typing quirk, not a lie: AbstractType<T> is invariant
      // in T (its event-handler types), while addToScope takes any shared type.
      manager.addToScope(type as unknown as Y.AbstractType<any>);
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
      manager.destroy();
    },
  };
}
