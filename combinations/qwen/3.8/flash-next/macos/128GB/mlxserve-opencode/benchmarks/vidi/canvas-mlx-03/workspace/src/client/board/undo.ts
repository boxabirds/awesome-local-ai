// Per-user undo history (design `undo.history`): one controller per board tab.
//
// ## Why this is a *personal* history without a server that knows about people
//
// Story 2 made every local mutation `doc.transact(fn, LOCAL_ORIGIN)`; story 3
// applies everything a colleague sent with the websocket provider as the origin;
// story 4 loads a saved board with `LOAD_ORIGIN`. Yjs's `UndoManager` decides what
// to remember by *origin*, not by person, and that is exactly the filter this
// board needs: a controller that tracks `LOCAL_ORIGIN` alone holds only what was
// typed, dragged, coloured and deleted in this tab, and its `undo()` can therefore
// only ever reverse this person's own work. Five people on one board have five
// independent controllers in five tabs and nothing else — there is no shared
// history, no server-side stack and nothing to keep in step.
//
// An undo is a change like any other: it is applied to the document and synced to
// everyone else, who sees it as an ordinary remote edit and never captures it.
//
// ## Why there are boundaries at all
//
// `captureTimeout` merges transactions that land within `UNDO_CAPTURE_TIMEOUT_MS`
// of each other. That is right for typing — "hello" is one step, not five — but it
// would also merge two unrelated clicks that happen to be quick. So every action
// that is one *intent* (a drag, a delete, a colour, a note) is fenced in with
// `boundary()`, and typing is the only thing left to merge on the clock. Inside one
// drag the per-frame writes are never fenced, which is what makes a 30-frame drag
// a single step.
//
// ## Nothing is ever undone that should not be
//
// Undoing the move of a note that a colleague deleted in the meantime targets a
// struct that no longer exists; Yjs applies nothing and moves on. Undoing my own
// delete puts the note back with whatever it held at the moment I deleted it,
// including a colleague's edit that arrived in between. Neither case throws.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config.ts';

/**
 * The tab's own undo/redo history. Only transactions this tab wrote (origin
 * `LOCAL_ORIGIN`) are ever captured, so nothing a colleague did — or a load
 * applied — is undone from here (undo.own).
 */
export interface UndoController {
  /** Undo this tab's last step; false when the undo stack is empty. */
  undo(): boolean;
  /** Re-apply the last undone step; false when the redo stack is empty. */
  redo(): boolean;
  /** Close the capture window: the next own change opens a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Widen what this controller tracks (story 16 adds the comments type). The type
   * parameter is `any` for the same reason yjs declares its scope that way: a
   * `Y.Map<Y.Map<unknown>>` is not assignable to `AbstractType<unknown>`.
   */
  addScope(type: Y.AbstractType<any>): void;
  /** Subscribe to stack changes; returns the unsubscribe function. */
  onChange(cb: () => void): () => void;
  /** Dispose of it; the history is this tab's memory only (undo.session_only). */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst, in ms. Defaults to UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Undo steps to remember. Defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
}

/**
 * `UndoManager` really has a `destroy()` — it is what detaches the manager from the
 * document — but the published typings only expose the inherited observable
 * `destroy`, which leaves the transaction listener in place. This is the real one.
 */
type WithRealDestroy = { destroy: () => void };

/**
 * Create the undo history of one board tab. Call it once per `Y.Doc` (the board
 * that owns the document does), and `destroy()` it when that board goes away.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  // The scope is the objects map: every board object lives in it, and a change to
  // an object's nested `Y.Text` counts as a change to it. Story 16 adds the
  // comments type with `addScope`; nothing else needs to know about it.
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const manager = new Y.UndoManager(objects, {
    captureTimeout: captureTimeoutMs,
    // The set the whole story rests on: this tab's own writes, and — added by
    // `UndoManager` itself — the transactions its undo/redo apply, which is how an
    // undone step lands on the redo stack instead of back on the undo one.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };

  const onStackChanged = (event: { type: 'undo' | 'redo' }) => {
    // undo.limit: the oldest step goes first. Only the undo stack can grow without
    // bound; the redo stack only ever holds what this tab has just undone.
    if (event.type === 'undo') {
      while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
    }
    notify();
  };

  manager.on('stack-item-added', onStackChanged);
  manager.on('stack-item-popped', onStackChanged);
  manager.on('stack-cleared', notify);

  let destroyed = false;

  /** One step off `stack`, whatever the document looks like on the other side. */
  const pop = (stack: 'undoStack' | 'redoStack', apply: () => unknown): boolean => {
    if (destroyed || manager[stack].length === 0) return false;
    // A step whose inverse hits an object a colleague deleted applies nothing: Yjs
    // consumes it and keeps looking, which never throws and never resurrects.
    apply();
    // No `stack-item-popped` fires for a step that applied nothing, so the button
    // state has to be refreshed here as well.
    notify();
    return true;
  };

  return {
    undo: () => pop('undoStack', () => manager.undo()),
    redo: () => pop('redoStack', () => manager.redo()),
    boundary: () => {
      if (!destroyed) manager.stopCapturing();
    },
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope: (type: Y.AbstractType<any>) => {
      if (!destroyed) manager.addToScope(type);
    },
    onChange: (cb: () => void) => {
      if (destroyed) return () => {};
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      listeners.clear(); // nobody is told anything after the controller is gone
      (manager as unknown as WithRealDestroy).destroy();
    },
  };
}
