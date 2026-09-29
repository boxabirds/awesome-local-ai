// Per-person undo history for one board doc (story 8, undo.history).
//
// One controller wraps one `Y.UndoManager` over the board's objects map, and the
// ONE thing that makes it personal instead of destructive is its origin filter:
// `trackedOrigins = {LOCAL_ORIGIN}`, which is exactly what `board-model` wraps
// every local mutation in. Everything that arrives from anyone else — the
// provider's origin for a colleague's change, story 4's LOAD_ORIGIN for a board
// read back from storage — is a different origin, is never captured, and so can
// never be stepped back by this person's undo (undo.own). Each tab builds its
// own controller over its own doc, so five people on one board have five
// independent histories and nobody's buttons are ever anyone else's.
//
// The inverse operation itself is applied by Yjs as a transaction of the
// manager's own origin: it syncs to everyone like any other change (the notes
// come back on every screen), and it is not re-captured as a fresh edit.
//
// Two behaviours sit on top of the manager:
//  * the capture window (`boundary`, `undo.boundaries`), see below;
//  * the history length (`undo.limit`): the oldest step is dropped when the undo
//    stack would grow past `maxSteps`.
//
// ## The capture window
//
// Yjs merges tracked transactions into one step while the gap between them is
// under `captureTimeout`, which is right for typing but would also merge two
// unrelated clicks half a second apart. The window this controller owns:
//  * `boundary()` closes it immediately, so a gesture, an edit session or any
//    single model call is exactly one step whatever frames it was made of;
//  * a pause of `captureTimeoutMs` closes it on its own, which is the only thing
//    that splits one run of typing into two steps (`undo.typing`).
// The timer is rearmed by every captured change, so frames inside one drag never
// split and keystrokes inside one burst never split, and the boundary values are
// testable against the same clock the app's own timers use.
//
// Nothing here persists: the history is memory-only, and a fresh controller after
// a reload or on a new board starts empty (undo.session_only).
import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model.ts';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config.ts';

/** What the board's keyboard, buttons, gestures and text editor talk to. */
export interface UndoController {
  /** Reverse this person's most recent change. False when there is none. */
  undo(): boolean;
  /** Re-apply the most recently undone change. False when there is none. */
  redo(): boolean;
  /** Close the capture window: the next change starts a new step. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Widen what undo covers (story 16 adds the comments map). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to stack-state changes; returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Stop observing the doc and drop this history. */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a burst. Defaults to UNDO_CAPTURE_TIMEOUT_MS. */
  captureTimeoutMs?: number;
  /** Steps kept per person. Defaults to UNDO_MAX_STEPS. */
  maxSteps?: number;
}

/** The shape yjs hands to `stack-item-added` / `-updated` / `-popped`. */
interface StackItemEventLike {
  type: 'undo' | 'redo';
}

/** A positive setting value, or the product default when the value is unusable. */
function setting(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = setting(opts.captureTimeoutMs, UNDO_CAPTURE_TIMEOUT_MS);
  const maxSteps = Math.floor(setting(opts.maxSteps, UNDO_MAX_STEPS));

  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    // The origin filter is the whole of "my changes only": this tab's own
    // mutations and nothing else.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };

  // --- capture window ------------------------------------------------------
  const closeWindow = (): void => {
    if (pauseTimer !== null) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    manager.stopCapturing();
  };

  // A burst ends captureTimeoutMs after its LAST keystroke; every captured
  // change rearms the pause timer, so a long drag or a long burst stays one step.
  const rearmWindow = (): void => {
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = setTimeout(closeWindow, captureTimeoutMs);
  };

  // --- history length (undo.limit) -----------------------------------------
  // The oldest step leaves the front of the stack, and with it the ability to
  // undo that action; the board itself is untouched.
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onAdded = (event: StackItemEventLike): void => {
    if (event.type === 'undo') {
      rearmWindow();
      trim();
    } else {
      // An undo added a redo step; the window is closed either way, so the next
      // change of mine starts its own step.
      closeWindow();
    }
    notify();
  };

  const onUpdated = (): void => {
    rearmWindow();
    notify();
  };

  const onPopped = (): void => {
    closeWindow();
    notify();
  };

  const onCleared = (): void => {
    notify();
  };

  manager.on('stack-item-added', onAdded);
  manager.on('stack-item-updated', onUpdated);
  manager.on('stack-item-popped', onPopped);
  manager.on('stack-cleared', onCleared);

  const alive = (): boolean => !destroyed;

  return {
    // An inverse that targets something someone else deleted simply applies
    // nothing: yjs finds the item deleted and changes no visible state, and no
    // error reaches the person pressing the key (undo.safe).
    //
    // The listeners are told either way. yjs announces a step only when it managed
    // to perform one, and it consumes every step it tried on the way to finding out
    // there was nowhere left to land - so without this the history would be empty
    // while the board went on offering the step.
    undo(): boolean {
      if (!alive()) return false;
      const performed = manager.undo() != null;
      notify();
      return performed;
    },
    redo(): boolean {
      if (!alive()) return false;
      const performed = manager.redo() != null;
      notify();
      return performed;
    },
    boundary(): void {
      if (!alive()) return;
      closeWindow();
    },
    canUndo(): boolean {
      return alive() && manager.canUndo();
    },
    canRedo(): boolean {
      return alive() && manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (!alive()) return;
      manager.addToScope(type);
    },
    onChange(cb: () => void): () => void {
      if (!alive() || typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (pauseTimer !== null) {
        clearTimeout(pauseTimer);
        pauseTimer = null;
      }
      listeners.clear();
      manager.off('stack-item-added', onAdded);
      manager.off('stack-item-updated', onUpdated);
      manager.off('stack-item-popped', onPopped);
      manager.off('stack-cleared', onCleared);
      // History is memory-only: destroying drops it, and the next controller
      // (after a reload, or for a different board) starts with nothing.
      manager.destroy();
    },
  };
}
