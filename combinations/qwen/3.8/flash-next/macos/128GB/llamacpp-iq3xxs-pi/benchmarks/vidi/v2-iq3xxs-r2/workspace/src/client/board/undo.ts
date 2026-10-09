import * as Y from 'yjs';
import { LOCAL_ORIGIN, OBJECTS_MAP } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * One person's undo history on one board (story 8).
 *
 * The whole design fits in the origin filter: `Y.UndoManager` is told to track
 * `LOCAL_ORIGIN` and nothing else, so the undo and redo stacks of this tab contain
 * exclusively the transactions this tab made (key decision 1). Changes from other people
 * arrive through the provider with the provider as their origin, and story 4's load applies
 * updates with its own; both are invisible to the stacks, which is why undoing here can
 * never reverse anyone else's work (`undo.own`), and why five people undo independently.
 *
 * What the manager applies in an undo is the inverse of one stack item, written as a new
 * transaction that syncs like any other change — so every other screen sees the note come
 * back, and nobody has to reload.
 */
export interface UndoController {
  /** Reverse this person's most recent change. False when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is nothing to redo. */
  redo(): boolean;
  /**
   * Close the current capture window: the next change opens a new step even if it lands
   * within `UNDO_CAPTURE_TIMEOUT_MS`. Gestures and text edits call this at both ends, so a
   * drag of 30 frames is one step and two quick clicks are two.
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Put another shared type in this history's scope (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Called after any change to either stack; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Stop observing the document; a new controller starts with an empty history. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst; defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Steps kept; defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

/**
 * Start watching `doc` for this tab's own changes.
 *
 * The scope is the objects map, so every object type — the ones stories 9–12 add, and
 * comments through `addScope` — is covered by the same history with no new undo code
 * (key decision 4). Creating a controller is cheap and holds no state of its own: after a
 * reload the histories are empty because nothing survives the page (`undo.session_only`).
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = Math.max(1, opts.maxSteps ?? UNDO_MAX_STEPS);
  const scope = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
  const manager = new Y.UndoManager(scope, {
    // Only this tab's transactions are captured (undo.own): the provider, the load, and
    // the manager's own inverse changes all arrive with a different origin.
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  /** `undo.limit`: the newest `maxSteps` items only; the oldest go out the front. */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onAdded = (): void => {
    trim();
    notify();
  };
  const onChanged = (): void => {
    notify();
  };
  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-popped', onChanged);
  manager.on('stack-item-updated', onChanged);
  // A new local step clears the redo stack, which changes `canRedo` without any item being
  // added or popped, so the buttons would go stale without this one.
  manager.on('stack-cleared', onChanged);

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed || manager.undoStack.length === 0) return false;
      // A step whose object somebody else deleted applies nothing and throws nothing;
      // the step is consumed either way (`undo.safe`).
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
    canUndo: () => !destroyed && manager.undoStack.length > 0,
    canRedo: () => !destroyed && manager.redoStack.length > 0,
    addScope(type: Y.AbstractType<unknown>): void {
      if (!destroyed) manager.addToScope(type);
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
      manager.off('stack-item-popped', onChanged);
      manager.off('stack-item-updated', onChanged);
      manager.off('stack-cleared', onChanged);
      manager.destroy();
      listeners.clear();
    },
  };
}
