// Per-person undo and redo (`undo.history`, `undo.own`).
//
// A thin controller over `Y.UndoManager` scoped to this tab's own transactions, so
// a person can undo their last action without ever reversing anyone else's work.
// Only transactions opened with `LOCAL_ORIGIN` (every local model call in
// `board-model`) enter the stacks; remote changes arrive with the provider as
// origin and story 4 load changes with the load origin, and neither is tracked.
//
// See NOTES.md: `Y.UndoManager` decides whether to merge two tracked changes with
// `lib0/time`'s `getUnixTime`, which is `Date.now` captured at module load and so
// cannot be reached by a test's fake clock. The controller therefore owns the
// capture-window lifetime: it closes the window with a timer it can control, and
// by calling `stopCapturing()` at every explicit gesture/edit/toolbar boundary.
// `Y`'s own `captureTimeout` is set to the same value so, with a real clock, the
// two agree; the controller's timer is the one that actually splits a typing burst.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/** The objects map is the undo scope; story 16 adds `comments` via `addScope`. */
const OBJECTS = 'objects';

/** The whole contract the shortcuts, buttons and React bindings are written to. */
export interface UndoController {
  /** Reverse this person's most recent change; false when nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change; false when nothing to redo. */
  redo(): boolean;
  /** Close the current capture window so the next change is a fresh step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the undo scope (story 16 uses this for the comments map). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to any change in either stack; returns an unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Dispose the manager; a fresh controller over the same doc starts empty. */
  destroy(): void;
}

export interface CreateUndoOptions {
  captureTimeoutMs?: number;
  maxSteps?: number;
}

/**
 * Wrap a board document in a personal undo history. Defaults come from the two
 * named product settings; a test may pass a different capture timeout.
 */
export function createUndo(doc: Y.Doc, opts: CreateUndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  // `trackedOrigins` is mutated by the manager (it adds itself), so hand it a
  // private Set holding exactly the one origin that means "this tab did it".
  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>(OBJECTS), {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // The capture window. Every tracked change re-arms a timer; when it fires with
  // no change for `captureTimeoutMs`, the window is closed so the *next* tracked
  // change becomes its own step (that is how a typing burst splits on a pause).
  // An explicit `boundary()` closes the window right now, so a gesture or an edit
  // never merges with its neighbour, while the frames inside one gesture do.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const armWindow = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      manager.stopCapturing();
    }, captureTimeoutMs);
  };

  // Keep the undo stack inside the limit by dropping the oldest steps. Only ever
  // done for a new local change, never while undoing or redoing.
  const trim = (): void => {
    if (manager.undoing || manager.redoing) return;
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onTracked = (): void => {
    armWindow();
    trim();
    notify();
  };
  const onPopped = (): void => notify();

  manager.on('stack-item-added', onTracked);
  manager.on('stack-item-updated', onTracked);
  manager.on('stack-item-popped', onPopped);
  manager.on('stack-cleared', onPopped);

  let destroyed = false;

  return {
    undo(): boolean {
      if (destroyed) return false;
      clearTimer();
      return manager.undo() != null;
    },
    redo(): boolean {
      if (destroyed) return false;
      clearTimer();
      return manager.redo() != null;
    },
    boundary(): void {
      if (destroyed) return;
      clearTimer();
      manager.stopCapturing();
    },
    canUndo(): boolean {
      return manager.canUndo();
    },
    canRedo(): boolean {
      return manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
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
      clearTimer();
      listeners.clear();
      manager.off('stack-item-added', onTracked);
      manager.off('stack-item-updated', onTracked);
      manager.off('stack-item-popped', onPopped);
      manager.off('stack-cleared', onPopped);
      manager.destroy();
    },
  };
}
