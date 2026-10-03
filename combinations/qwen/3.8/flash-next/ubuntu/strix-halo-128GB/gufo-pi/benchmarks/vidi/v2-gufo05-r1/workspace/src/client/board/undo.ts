/**
 * This person's undo history (`undo.own`, `undo.history`).
 *
 * A `Y.UndoManager` over the objects map, with one decision doing all the work: it
 * tracks `LOCAL_ORIGIN` and nothing else. Every mutation the board makes runs in a
 * transaction with that origin (`board-model`), while everything that arrives from
 * somebody else comes in through the provider with the socket as its origin, and a
 * board read back out of storage comes in with the load origin. So this controller's
 * stacks can only ever hold this tab's own steps, which is what makes an undo here
 * personal: pressing Ctrl+Z reverses what *I* did last and leaves everything a
 * colleague did in the meantime exactly where it is (`undo.own`, TC-01, TC-02, TC-03).
 *
 * Two things on top of the manager:
 *
 * **The capture window.** `boundary()` closes the current window, so the next change
 * starts a new step, and transactions inside an open window merge into one step. A
 * drag writes once per animation frame and is one step; typing merges until the
 * pause reaches `UNDO_CAPTURE_TIMEOUT_MS` (`undo.steps`, `undo.typing`). The window is
 * measured on this module's clock rather than on the manager's own, which is what
 * lets TC-13 test the boundary of that timeout exactly instead of sleeping and hoping.
 *
 * **One step per press.** `Y.UndoManager.undo()` pops stack items until one of them
 * changes something, which is wrong for a board: when my last step targets an object
 * somebody else deleted, it cannot be reversed, and continuing would silently undo
 * the step under it too. So the steps below the top one are held back for the
 * duration of the call: a step that changes nothing is consumed on its own, nothing
 * visible happens, and the rest of the history stays usable (`undo.safe`, TC-07).
 *
 * The scope is the objects map. A change to anything inside an object — including the
 * `Y.Text` of a note, and the text, shapes or comments of stories 9 to 12 and 16 — is
 * inside that scope, so new object types need no undo code (`undo.steps`). Story 16
 * adds its own container with `addScope`.
 */
import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECTS_KEY } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

export interface UndoController {
  /** Reverse my most recent step. `false` when there is nothing to undo. */
  undo(): boolean;
  /** Re-apply my most recently undone step. `false` when there is nothing to redo. */
  redo(): boolean;
  /** Close the capture window: the next change is a step of its own. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bring another shared container into the history (story 16: comments). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Subscribe to the stacks changing. Returns the unsubscribe. */
  onChange(cb: () => void): () => void;
  /** Stop watching the document. A new controller starts empty (`undo.session_only`). */
  destroy(): void;
}

/** The part of a keydown that the undo shortcuts are read from. */
export interface UndoGestureKeys {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Does this keystroke mean undo or redo (`undo.shortcuts`)?
 *
 * Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Alt is left alone, because a
 * combination involving it belongs to the browser or to the input method, and so is Cmd+Y,
 * which has no convention behind it — the contract names Ctrl+Y, the Windows spelling.
 *
 * It lives here because a step is defined in this file, and the key that takes one step
 * back has to mean exactly that: the same reading in the window handler and in the text
 * editor, which are the two places that can be asked.
 */
export function undoGesture(event: UndoGestureKeys): 'undo' | 'redo' | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    return event.shiftKey ? 'redo' : 'undo';
  }
  if (event.ctrlKey && !event.metaKey && key === 'y') return 'redo';
  return null;
}

export interface UndoOptions {
  /** Typing pause that ends a burst. Defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Steps kept before the oldest is dropped. Defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
  /**
   * The clock the capture window is measured on. Injectable so a test can move time
   * by the millisecond instead of waiting for it.
   */
  now?(): number;
}

/** The wall clock, read through a call so a test can replace it wholesale. */
const systemNow = (): number => Date.now();

export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;
  const now = opts.now ?? systemNow;

  const listeners = new Set<() => void>();
  let destroyed = false;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /**
   * The last local change, on this module's clock.
   *
   * `0` means "no window is open": the next change starts a step whatever the time.
   */
  let lastLocalChange = 0;

  /**
   * Close the capture window, on the manager and on this clock together.
   *
   * The two are one operation: a window that is closed on the manager but still open
   * here would reopen itself on the next change.
   */
  const closeWindow = (): void => {
    manager.stopCapturing();
    lastLocalChange = 0;
  };

  // Installed *before* the manager is built, so this runs first on every transaction:
  // Yjs decides whether to merge a change into the step above it in the same breath as
  // it records it, so the decision "this burst has ended" has to be taken before that.
  const onAfterTransaction = (transaction: Y.Transaction): void => {
    if (transaction.origin !== LOCAL_ORIGIN) return; // remote, load, or our own undo
    const at = now();
    if (lastLocalChange !== 0 && at - lastLocalChange >= captureTimeoutMs) {
      manager.stopCapturing();
    }
    lastLocalChange = at;
  };
  doc.on('afterTransaction', onAfterTransaction);

  const manager = new Y.UndoManager(doc.getMap(OBJECTS_KEY), {
    // Only my own transactions are recorded (undo.own). The manager adds itself to
    // this set, which is how its own undo/redo transactions reach the other stack.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    // Merging is this module's decision (see `onAfterTransaction`), so the manager is
    // told to merge until it is told not to.
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });

  /**
   * Forget the oldest steps over the limit (`undo.limit`).
   *
   * Only the undo stack is trimmed: the redo stack holds the steps this person has
   * just undone, which is a handful by construction.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  const onStackAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type === 'undo') trim();
    notify();
  };
  manager.on('stack-item-added', onStackAdded);
  // A merged change does not add an item but can still drop the redo stack.
  manager.on('stack-item-updated', notify);
  manager.on('stack-item-popped', () => {
    // An undone step is never extended by the next thing this person types.
    closeWindow();
    notify();
  });
  manager.on('stack-cleared', notify);

  /**
   * Pop exactly one step.
   *
   * The steps under the top one are taken out of the stack for the duration of the
   * call, because `Y.UndoManager` keeps popping until it finds a step that changes
   * something. With the rest held back, a step that cannot be reversed — one whose
   * object was deleted by somebody else — is simply consumed, and this person's
   * history is one step shorter instead of two (`undo.safe`).
   */
  const step = (direction: 'undo' | 'redo'): boolean => {
    if (destroyed) return false;
    const stack = direction === 'undo' ? manager.undoStack : manager.redoStack;
    if (stack.length === 0) return false;
    const held = stack.splice(0, stack.length - 1);
    let applied = false;
    try {
      applied = direction === 'undo' ? manager.undo() !== null : manager.redo() !== null;
    } finally {
      // The manager may have replaced the array it holds; put the held steps back
      // where they were, oldest first, whatever it is now.
      const live = direction === 'undo' ? manager.undoStack : manager.redoStack;
      if (held.length > 0) live.unshift(...held);
      closeWindow();
    }
    notify();
    return applied;
  };

  return {
    undo: () => step('undo'),
    redo: () => step('redo'),
    boundary: closeWindow,
    // A destroyed controller reports an empty history rather than the one it had: it is
    // the state of a board that has been left, where there is nothing to undo.
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    addScope: (type) => {
      manager.addToScope(type);
    },
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('afterTransaction', onAfterTransaction);
      listeners.clear();
      manager.destroy();
    },
  };
}
