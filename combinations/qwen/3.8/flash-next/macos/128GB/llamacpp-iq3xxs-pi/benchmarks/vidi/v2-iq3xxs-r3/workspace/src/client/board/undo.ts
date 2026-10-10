/**
 * The per-person undo history (`undo.history`, `undo.own`).
 *
 * One `UndoController` per board document, per tab. It is a thin skin over
 * `Y.UndoManager` scoped to the objects map and fed only the transactions this
 * tab started itself: story 2 writes every local mutation with `LOCAL_ORIGIN`,
 * story 3 applies everything that arrives from the room with the provider as
 * origin, and story 4's load applies updates with its own origin — so tracking
 * `LOCAL_ORIGIN` alone is what makes "undo only my own changes, whatever
 * anybody else is doing" a property of the history rather than a rule this file
 * has to enforce. There is no server-side or shared history anywhere: another
 * person's tab has its own controller, and undoing here never touches what they
 * can undo there.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECTS_KEY } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * What the board calls to undo and redo its own work. Every method is safe to
 * call at any moment: an empty stack answers `false` rather than throwing, and
 * an inverse whose target somebody else has already deleted simply has no
 * effect (`undo.safe`).
 */
export interface UndoController {
  /** Undo the last own step; `false` when there is nothing of mine to undo. */
  undo(): boolean;
  /** Redo the last step I undid; `false` when there is nothing to redo. */
  redo(): boolean;
  /**
   * Close the current capture window (`undo.capture`): the change that comes
   * after this is a new step whatever the clock says. Called at the start and
   * the end of a gesture and of a text edit, and around each toolbar and
   * keyboard command, so one action is one step and frames inside one drag
   * still merge into one.
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Widen what this history covers (story 16 adds the `comments` map this way).
   * New *object types* never need it: they live under the objects map, which is
   * already in scope.
   */
  addScope<T>(type: Y.AbstractType<T>): void;
  /** Hear about stack changes; returns the unsubscribe. */
  onChange(callback: () => void): () => void;
  /** Stop observing the document. History is session-only, and this is its end. */
  destroy(): void;
}

export interface UndoControllerOptions {
  /** Defaults to `UNDO_CAPTURE_TIMEOUT_MS`; tests set it to wait less. */
  readonly captureTimeoutMs?: number;
  /** Defaults to `UNDO_MAX_STEPS`. */
  readonly maxSteps?: number;
  /** Defaults to the objects map; a `Y.Doc` in here would track the whole board. */
  readonly scope?: Y.AbstractType<unknown> | readonly Y.AbstractType<unknown>[];
  /** Defaults to `LOCAL_ORIGIN` only. */
  readonly trackedOrigins?: ReadonlySet<unknown>;
}

/**
 * The history of one person's work on one board (`undo.own`).
 *
 * @param doc The board document, the same one every mutation goes through.
 */
export function createUndo(
  doc: Y.Doc,
  {
    captureTimeoutMs = UNDO_CAPTURE_TIMEOUT_MS,
    maxSteps = UNDO_MAX_STEPS,
    scope,
    trackedOrigins,
  }: UndoControllerOptions = {},
): UndoController {
  // The objects map, never the whole document: the board's own metadata
  // (`meta`) is nobody's work to undo, and story 16's comments join through
  // `addScope` when they arrive.
  const scoped: Y.AbstractType<unknown>[] =
    scope === undefined
      ? [doc.getMap(OBJECTS_KEY)]
      : Array.isArray(scope)
        ? [...scope]
        : [scope];

  const manager = new Y.UndoManager(scoped, {
    // A fresh Set each time: `Y.UndoManager` adds *itself* to the set it is
    // handed, so a shared constant would end up tracked by every board open in
    // this tab — and one person's undo would then be captured in another's.
    trackedOrigins: new Set<unknown>(trackedOrigins ?? [LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  // `undo.bounded`: the oldest step goes when the history is full. Only the
  // undo stack is trimmed — redo is what this person just undid, and dropping
  // it would be losing work they never asked to lose.
  const trim = (stack: Y.UndoManager['undoStack']): void => {
    while (stack.length > maxSteps) stack.shift();
  };

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  // Both events mean the same thing to the board: whether Undo and Redo are
  // still worth showing.
  manager.on('stack-item-added', (event) => {
    if (event.type === 'undo') trim(manager.undoStack);
    notify();
  });
  manager.on('stack-item-popped', notify);

  return {
    // `Y.UndoManager.undo()` returns the step it applied, or `null` when it
    // found nothing to apply — which is also what happens when the objects my
    // own change touched have been deleted by somebody else: no effect, no
    // error, and the rest of the history stays usable.
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    boundary: () => {
      manager.stopCapturing();
    },
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => {
      manager.addToScope(type);
    },
    onChange: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy: () => {
      listeners.clear();
      manager.destroy();
    },
  };
}
