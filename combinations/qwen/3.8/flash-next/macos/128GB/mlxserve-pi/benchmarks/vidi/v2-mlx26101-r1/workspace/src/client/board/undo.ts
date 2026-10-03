// Per-user undo / redo history (story 8). See the undo.history contract.
//
// The whole story is about transaction *origin*. Story 2 made every local
// mutation a `doc.transact(fn, LOCAL_ORIGIN)`; story 3 applies remote updates with
// the provider as origin and story 4 replays a board load with LOAD_ORIGIN. A
// `Y.UndoManager` scoped to the `objects` map and tracking ONLY `LOCAL_ORIGIN`
// therefore holds exactly this person's own changes on its undo/redo stacks and
// nothing anyone else did. Undoing applies the inverse as a fresh transaction that
// syncs like any other change (undo.own, undo.redo); a new local step clears redo
// (UndoManager's default, undo.redo_cleared); an inverse whose object a colleague
// deleted in the meantime simply has no effect and never throws (undo.safe),
// because Yjs never recreates content the user did not delete.
//
// The history is memory-only: it is created per board doc in `App.tsx` and
// destroyed on board change/unmount, so a reload starts empty (undo.session_only).

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import {
  UNDO_CAPTURE_TIMEOUT_MS,
  UNDO_MAX_STEPS,
} from '../../shared/config';

/**
 * The undo surface the rest of the client talks to. `undo()`/`redo()` return
 * false when there is nothing to do (and never throw); `boundary()` closes the
 * current capture window so a completed gesture or edit is exactly one step;
 * `addScope` lets story 16 add the `comments` type without touching this file.
 */
export interface UndoController {
  /** Reverse this tab's most recent change; false when the undo stack is empty. */
  undo(): boolean;
  /** Re-apply the most recently undone change; false when the redo stack is empty. */
  redo(): boolean;
  /** Close the current capture window (call at gesture / edit boundaries). */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend the undo scope with another shared type (story 16: comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack changes (any add / pop); returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose the underlying manager; a fresh controller afterwards starts empty. */
  destroy(): void;
}

export interface CreateUndoOptions {
  /** Typing / gesture capture window in ms (default UNDO_CAPTURE_TIMEOUT_MS). */
  captureTimeoutMs?: number;
  /** Maximum undo steps kept (default UNDO_MAX_STEPS). */
  maxSteps?: number;
}

/**
 * Create a personal undo controller for `doc`.
 */
export function createUndo(
  doc: Y.Doc,
  opts: CreateUndoOptions = {},
): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const manager = new Y.UndoManager(objects, {
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // Trim the undo stack whenever a step is added (undo.limit). Yjs grows the
  // stack without bound, so we drop the oldest item once past `maxSteps`.
  const onItemAdded = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    notify();
  };
  const onItemPopped = (): void => notify();

  manager.on('stack-item-added', onItemAdded);
  manager.on('stack-item-popped', onItemPopped);

  return {
    undo(): boolean {
      // `undo()` returns the popped StackItem only when a change was actually
      // applied. An inverse whose object a colleague deleted has no effect and
      // yields null — which we report as false and never as an error (undo.safe).
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
      manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      manager.off('stack-item-added', onItemAdded);
      manager.off('stack-item-popped', onItemPopped);
      listeners.clear();
      manager.destroy();
    },
  };
}

/**
 * A `UndoController` whose real `Y.UndoManager` can be attached and detached
 * independently of the object's own identity. This exists so the controller can
 * live in React: `App`/`Board` hold one stable facade across renders, while the
 * underlying manager is created in an effect on mount and destroyed on unmount.
 *
 * That split is what makes the controller survive `React.StrictMode`'s extra
 * mount / unmount / mount in development: the phantom unmount tears the manager
 * down and the remount builds a fresh (empty) one, so the facade is always safe to
 * call and history is never left pointing at a disposed manager. A detach → attach
 * cycle also starts empty, which is exactly the reload / re-mount behaviour
 * (undo.session_only). The facade itself is stable, so it is safe as a context
 * value and as an effect dependency.
 */
export interface UndoFacade extends UndoController {
  /** Install a live manager, re-registering subscribers and scopes. Call on mount. */
  attach(manager: UndoController): void;
  /** Destroy the current manager; the facade stays usable and empty. Call on unmount. */
  detach(): void;
}

/** A manager-less controller: every action is a safe no-op (nothing to undo). */
const INACTIVE: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => {},
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => {},
  onChange: () => () => {},
  destroy: () => {},
};

export function createUndoFacade(): UndoFacade {
  let active: UndoController | null = null;
  // cb -> its unsubscribe on the current manager (rebuilt on every attach).
  const subscribers = new Map<() => void, () => void>();
  // Scopes added before / across mounts (story 16 comments), re-added on attach.
  const scopes = new Set<Y.AbstractType<unknown>>();

  const cur = (): UndoController => active ?? INACTIVE;

  return {
    undo: () => cur().undo(),
    redo: () => cur().redo(),
    boundary: () => cur().boundary(),
    canUndo: () => cur().canUndo(),
    canRedo: () => cur().canRedo(),
    addScope(type: Y.AbstractType<unknown>): void {
      scopes.add(type);
      active?.addScope(type);
    },
    onChange(cb: () => void): () => void {
      if (active) subscribers.set(cb, active.onChange(cb));
      else subscribers.set(cb, () => {});
      return () => {
        const off = subscribers.get(cb);
        off?.();
        subscribers.delete(cb);
      };
    },
    destroy(): void {
      this.detach();
    },
    attach(manager: UndoController): void {
      active = manager;
      // Re-register every current subscriber and remembered scope on the fresh
      // manager; any previous manager was already destroyed by a prior detach.
      for (const cb of subscribers.keys()) subscribers.set(cb, manager.onChange(cb));
      for (const scope of scopes) manager.addScope(scope);
    },
    detach(): void {
      if (!active) return;
      for (const off of subscribers.values()) off();
      subscribers.clear();
      active.destroy();
      active = null;
    },
  };
}
