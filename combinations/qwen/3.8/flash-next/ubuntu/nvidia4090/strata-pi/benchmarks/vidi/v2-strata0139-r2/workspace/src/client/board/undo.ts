import * as Y from "yjs";
import { LOCAL_ORIGIN } from "../../shared/board-model";
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from "../../shared/config";

/**
 * Undo and redo of **your own** changes on a shared board (story 8).
 *
 * Design decision 1: the only history this client keeps is the list of *its*
 * transactions — `trackedOrigins = {LOCAL_ORIGIN}`, the origin every board-model
 * call tags its transaction with. "Undo mine, never someone else's" is then a
 * property of the data structure rather than something to check change by change:
 * a colleague's change was never in the history to begin with.
 *
 * Design decision 2: the history belongs to the tab, not to the document. A
 * reload, a reconnect that recreates the doc, or a new tab all start empty
 * (`undo.history`); this module never puts a history anywhere persistent.
 *
 * Design decision 3: a step is a *gesture* or a *typing burst*, decided by
 * `boundary()`, not by how fast someone happened to type: Yjs merges consecutive
 * local transactions while they are within `captureTimeout` of each other, and a
 * boundary closes that window.
 *
 * Design decision 6: a stack item holds the inverse of *this tab's* transaction,
 * so undo can only ever touch structs this tab created or deleted — a colleague's
 * change is not merely untracked, it is unreachable from the inverse. That is why
 * TC-01, TC-07 and TC-08 hold without change-by-change checking, and why no Yjs
 * `deleteFilter` is needed (and would be wrong: it also gates the undo of my own
 * create).
 *
 * Framework-free on purpose: no React, no DOM, no transport. The only Yjs type it
 * knows is `Y.Doc` — which is what lets `tests/unit` cover the whole contract with
 * two real documents and no fake Yjs.
 */

/** How long typing may pause before the next character starts a new step. */
export interface UndoOptions {
  /** Defaults to `UNDO_CAPTURE_TIMEOUT_MS`. Tests that need the boundary exactly pass it. */
  captureTimeoutMs?: number;
  /** How many of this tab's steps are remembered. Defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

/**
 * The client's undo history. Everything a screen does with it goes through these
 * seven members, so the toolbar buttons, the shortcuts and the gesture code all
 * agree on what an undo step is.
 */
export interface UndoController {
  /**
   * Reverses the most recent step of *this tab's* history. `false` when there is
   * nothing to undo. A step whose object a colleague already deleted is consumed
   * and changes nothing here — but Yjs keeps looking for a step that can be
   * reversed, so the call may undo the step below it instead (see TC-07).
   */
  undo(): boolean;
  /** Re-applies the step `undo()` took back. `false` when there is nothing to redo. */
  redo(): boolean;
  /** Ends the current step: what comes next is a new one. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Extends the history to another top-level type in the document. Story 8 needs
   * exactly one scope (`objects`); story 16's comments will add theirs without
   * touching any undo code here.
   */
  // (`any` here is Yjs's own signature: `AbstractType`'s event-handler parameter
  // makes it invariant, so a `Y.Map<Y.Map<unknown>>` is not assignable to
  // `AbstractType<unknown>` even though it is one.)
  addScope(scope: Y.AbstractType<any>): void;
  /** Subscribes to "the stacks changed", which is what the toolbar buttons show. */
  onChange(listener: () => void): () => void;
  /** Releases the history. Idempotent: safe to call from an effect cleanup twice. */
  destroy(): void;
}

export function createUndo(doc: Y.Doc, options: UndoOptions = {}): UndoController {
  const captureTimeoutMs = options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = Math.max(0, options.maxSteps ?? UNDO_MAX_STEPS);

  const objects = doc.getMap<Y.Map<unknown>>("objects");
  const manager = new Y.UndoManager(objects, {
    captureTimeout: captureTimeoutMs,
    // Design decision 1, in one line. The provider's own object and story 4's
    // `LOAD_ORIGIN` are simply not in this set.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    doc,
  });

  const listeners = new Set<() => void>();
  let destroyed = false;

  /**
   * `undo.limit`: the history is a tab-local ring buffer of *whole* steps. Yjs
   * offers no bound of its own, and trimming whole items is the one trimming that
   * cannot leave a half-undone step behind. Oldest first.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const onStackChange = (): void => {
    trim();
    notify();
  };

  const subscribe = (): void => {
    manager.on("stack-item-added", onStackChange);
    manager.on("stack-item-updated", onStackChange);
    manager.on("stack-item-popped", onStackChange);
    manager.on("stack-cleared", onStackChange);
  };
  const unsubscribe = (): void => {
    manager.off("stack-item-added", onStackChange);
    manager.off("stack-item-updated", onStackChange);
    manager.off("stack-item-popped", onStackChange);
    manager.off("stack-cleared", onStackChange);
  };
  subscribe();
  trim();

  return {
    undo(): boolean {
      if (destroyed) return false;
      return manager.undo() != null;
    },
    redo(): boolean {
      if (destroyed) return false;
      return manager.redo() != null;
    },
    boundary(): void {
      if (destroyed) return;
      // Yjs's `stopCapturing`: the next local transaction starts a new step
      // whatever the clock says, and a boundary on its own adds nothing.
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return !destroyed && manager.redoStack.length > 0;
    },
    addScope(scope: Y.AbstractType<any>): void {
      if (destroyed) return;
      manager.addToScope(scope);
    },
    onChange(listener: () => void): () => void {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      listeners.clear();
      manager.destroy();
    },
  };
}
