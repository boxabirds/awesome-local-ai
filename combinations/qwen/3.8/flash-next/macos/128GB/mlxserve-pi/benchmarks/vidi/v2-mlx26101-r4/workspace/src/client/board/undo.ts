/**
 * Undo, for the person sitting at this keyboard and nobody else.
 *
 * The whole of this story is one filter. The document already records every change anybody makes, in
 * the order they arrived, and a history built out of *that* is a machine for erasing other people's
 * work: Mia moves a note, Raj adds one, Mia presses undo and Raj's note is gone — which is worse than
 * no undo at all, because it is silent. So this file does not build a history of the board, it builds a
 * history of *this tab's own transactions*, which is a different object entirely: every local mutation
 * in `board-model` is written with `LOCAL_ORIGIN` as its transaction origin, and everything that arrives
 * from the room — a colleague's keystroke, a note someone deleted, the board the room read off disk
 * before it was ever synced — arrives under some other origin and is invisible here.
 *
 * That is also why there is no per-user bookkeeping, no user ids and no server-side history. Each
 * person's tab has one controller over one document, and the five people on a board have five
 * controllers that never speak to one another. What undo writes back into the document is an ordinary
 * local change, so it travels to everybody else like anything else does: on Raj's screen, Mia's note
 * slides back to where it was.
 *
 * Two things come out of Yjs for free and are worth naming, because they are the difference between a
 * working undo and a destructive one:
 *
 *   - an inverse aimed at an object somebody else deleted does nothing. It does not throw, and it does
 *     not bring the object back — the object is not in the step, only the numbers that were written into
 *     it, and putting those back inside something that is gone changes nothing anybody can see;
 *   - undoing my own delete restores the object as it stood at the moment I deleted it, including
 *     whatever a colleague had typed into it a second before, because what is restored is the object,
 *     not a copy of what I last saw.
 *
 * The capture window is the other half of the design, and it is a clock rather than a rule: changes
 * closer together than `captureTimeoutMs` become one step, which is what makes a burst of typing one
 * thing and the sixty frames of one drag one thing. Anything that has to be a step on its own despite
 * being quick says so out loud with `boundary()`.
 */
import * as Y from 'yjs';

import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * What the board's interface is allowed to ask of the undo history.
 *
 * Everything returns a value rather than a story: `undo()` says whether there was anything to undo, and
 * the buttons and the shortcuts render from `canUndo()`/`canRedo()` and re-render on `onChange`.
 */
export interface UndoController {
  /** Reverse my last step. False when there is nothing of mine to undo. */
  undo(): boolean;
  /** Put back the last step I undid. False when there is nothing to put back. */
  redo(): boolean;
  /** Close the capture window: whatever comes next is a step of its own. */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bring another part of the document under history (story 16 calls this with `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Tell me when there is something to undo or redo. Returns the way to stop listening. */
  onChange(cb: () => void): () => void;
  /** Stop watching the document. A controller cannot be restarted, which is what undo.session_only is. */
  destroy(): void;
}

/**
 * The part of the history a component is allowed to reach for.
 *
 * A sticky note has no business asking how many steps its board holds, and no business emptying the
 * history; what it has to say is "what I just did is a thing of its own" and, while a note is open for
 * typing, "the keys I am being handed belong to this text". So the objects are given these three calls
 * rather than the controller, and the difference between the two is the difference between an object that
 * can mark the edges of an action and one that can reach into somebody's history.
 *
 * `UndoController` satisfies it, and so does the return value of {@link useUndo}, which is why the same
 * prop carries the controller in one place and the React binding in another.
 */
export interface UndoActions {
  /** Reverse my last step. */
  undo(): void;
  /** Put back the last step I undid. */
  redo(): void;
  /** Close the capture window: whatever comes next is a step of its own. */
  boundary(): void;
}

export interface UndoOptions {
  /** The pause that ends a typing burst; defaults to {@link UNDO_CAPTURE_TIMEOUT_MS}. */
  captureTimeoutMs?: number;
  /** How many steps to keep; defaults to {@link UNDO_MAX_STEPS}. */
  maxSteps?: number;
}

/**
 * A history of one person's own changes to one board document.
 *
 * One per board document per tab, created by the board that opens it and destroyed when that board goes
 * away — so a reload, or walking from one board to another, starts with nothing to undo.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>('objects'), {
    captureTimeout: captureTimeoutMs,
    // The filter this whole story is made of: this tab's transactions, and nothing else. The manager
    // adds itself to the set it is handed (that is how an undone step lands on the redo stack), so the
    // set belongs to this controller alone.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /**
   * Keep the history to `maxSteps` by dropping the oldest.
   *
   * Yjs has no length limit of its own — a tab that undoes for an hour would hold every step it ever
   * made — so the limit is applied here, at the one moment the stack grows. Dropping from the front is
   * the only end that makes sense: the oldest step is the one furthest behind what is on the screen,
   * and the one nobody is about to reach for.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  // The stack only changed when Yjs says it changed; `stack-item-updated` is the merge of a change into
  // the step already being captured, which cannot empty or fill a stack but is still news to anything
  // that would list the history.
  const stepAdded = (event: { type: 'undo' | 'redo' }): void => {
    if (event.type === 'undo') trim();
    notify();
  };
  const stackChanged = (): void => {
    notify();
  };
  manager.on('stack-item-added', stepAdded);
  manager.on('stack-item-updated', stackChanged);
  manager.on('stack-item-popped', stackChanged);
  manager.on('stack-cleared', stackChanged);

  return {
    // Whether there was anything to undo, rather than whether anything visibly changed: undoing a move
    // of a note somebody else deleted has nothing to show and still consumes the step it was given,
    // which is what the next undo carries on from.
    undo: () => manager.undo() !== null,
    redo: () => manager.redo() !== null,
    // The way to say "this is a new thing I did", from a gesture's start and end and from a text edit's
    // start and end. Without it, a colour clicked a breath after a drag would be swallowed into the
    // drag's step and would only come back with the drag.
    boundary: () => manager.stopCapturing(),
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
    addScope: (type) => {
      manager.addToScope(type);
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      listeners.clear();
      manager.off('stack-item-added', stepAdded);
      manager.off('stack-item-updated', stackChanged);
      manager.off('stack-item-popped', stackChanged);
      manager.off('stack-cleared', stackChanged);
      manager.destroy();
    },
  };
}
