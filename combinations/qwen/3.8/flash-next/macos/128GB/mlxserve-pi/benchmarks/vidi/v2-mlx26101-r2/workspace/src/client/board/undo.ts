/**
 * Per-person undo history (`src/client/board/undo.ts`, PRD "Undo and redo my own
 * changes").
 *
 * The whole story is one filter: a `Y.UndoManager` is handed
 * `trackedOrigins = new Set([LOCAL_ORIGIN])`, so only the transactions this tab
 * wrote through `board-model` ever reach its stacks. Everything a colleague did
 * arrives through the provider, with the provider as its origin (story 3), and
 * everything the room loaded arrives with the load origin (story 4); neither is
 * tracked, so neither is ever captured and neither can ever be undone. That is
 * the entire mechanism behind "undo only *my* changes" - there is no user id in
 * the history, no server-side stack and nothing shared: five people on one board
 * have five independent histories in five tabs, and an inverse operation is
 * itself an ordinary local change that syncs like any other.
 *
 * What a "step" is comes from the boundaries the callers draw (design
 * `undo.boundaries`), not from this file: `Y.UndoManager` merges tracked
 * transactions that arrive less than `captureTimeout` apart, which is exactly
 * right for a burst of typing and exactly wrong for two separate clicks. So a
 * gesture and a text edit call `boundary()` - `stopCapturing()` - when they
 * start and when they end, and the frames in between, which are milliseconds
 * apart, merge into the one step the user performed.
 *
 * Nothing here can fail: an empty stack answers `false`, and an inverse that
 * targets something a colleague deleted simply has nothing to apply (`undo.safe`).
 */

import * as Y from 'yjs';

import { DOC_OBJECTS_MAP, LOCAL_ORIGIN } from '../../shared/board-model.js';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config.js';

/** What a board gets to undo and redo its own changes with. */
export interface UndoController {
  /**
   * Reverse this person's most recent change.
   *
   * @returns `false` when there is nothing of theirs to undo; `true` when a step
   * was consumed - which includes the step that changed nothing visible because
   * a colleague had deleted its target in the meantime.
   */
  undo(): boolean;
  /** Re-apply the most recently undone change; `false` when the redo stack is empty. */
  redo(): boolean;
  /**
   * Close the current capture window: the next local change starts a new step.
   * Called at the start and end of a gesture and of a text edit, and before and
   * after a single model call (a delete, a colour, a creation). A no-op when
   * there is nothing to separate.
   */
  boundary(): void;
  /** Is there something of this person's to undo? */
  canUndo(): boolean;
  /** Is there something of this person's to redo? */
  canRedo(): boolean;
  /**
   * Track another shared type with the same history. Story 16 hands it the
   * `comments` map; a new *object* type needs nothing, because objects all live
   * in the one `objects` map that is already in scope (`undo.steps`, "future
   * types").
   */
  addScope(type: Y.AbstractType<any>): void;
  /**
   * Hear about every change to either stack (a step added, popped, or a stack
   * cleared by a new change), which is what keeps the two buttons honest.
   *
   * @returns the unsubscribe function.
   */
  onChange(cb: () => void): () => void;
  /** Dispose of the history. A fresh controller afterwards starts empty. */
  destroy(): void;
}

export interface UndoOptions {
  /** The typing pause that ends a burst (defaults to `UNDO_CAPTURE_TIMEOUT_MS`). */
  captureTimeoutMs?: number;
  /** How many steps to keep (defaults to `UNDO_MAX_STEPS`). */
  maxSteps?: number;
}

/**
 * The one shared type the history covers today: every object, with its position,
 * size, colour, stacking order and text. Story 16 adds `comments` through
 * `addScope`.
 */
const scopeOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(DOC_OBJECTS_MAP);

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  // A set of one: this tab's own transactions. `board-model` passes LOCAL_ORIGIN
  // to every `doc.transact` it makes; the provider applies remote updates with
  // itself as the origin, and story 4's load uses the load origin, so both fall
  // outside. (The manager adds itself to this set, which is how the inverse
  // transactions it runs land on the *redo* stack; it is a set we own.)
  const manager = new Y.UndoManager(scopeOf(doc), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  let destroyed = false;

  /**
   * `undo.limit`: the manager keeps its whole history, so the oldest step is
   * dropped here once the stack is longer than the setting. Dropping from the
   * front is the only direction that matches what a person expects to lose.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onAdded = (): void => {
    trim();
    notify();
  };
  const onPopped = (): void => {
    notify();
  };
  // A new local change clears the redo stack (PRD `undo.redo_cleared`), and the
  // manager says so with `stack-cleared` rather than with an add - without this
  // the Redo button would keep saying "there is something to redo" after the
  // thing to redo stopped existing.
  const onCleared = (): void => {
    notify();
  };

  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-popped', onPopped);
  manager.on('stack-cleared', onCleared);

  return {
    undo(): boolean {
      if (destroyed || manager.undoStack.length === 0) return false;
      // The manager's own return value says whether the inverse *changed*
      // anything; a step whose object a colleague deleted changes nothing and is
      // still the step that was asked for, so the answer here is the stack's.
      manager.undo();
      return true;
    },
    redo(): boolean {
      if (destroyed || manager.redoStack.length === 0) return false;
      manager.redo();
      return true;
    },
    boundary(): void {
      if (destroyed) return;
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return !destroyed && manager.undoStack.length > 0;
    },
    canRedo(): boolean {
      return !destroyed && manager.redoStack.length > 0;
    },
    addScope(type: Y.AbstractType<any>): void {
      if (destroyed) return;
      // The `any` in the parameter is yjs's own, not a hole in this one: an
      // AbstractType's event type is a type parameter, so a `Y.Map<unknown>` is not
      // assignable to `AbstractType<unknown>` even though it is exactly what the
      // scope holds.
      manager.addToScope(type);
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
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-popped', onPopped);
      manager.off('stack-cleared', onCleared);
      listeners.clear();
      manager.destroy();
    },
  };
}

export default createUndo;
