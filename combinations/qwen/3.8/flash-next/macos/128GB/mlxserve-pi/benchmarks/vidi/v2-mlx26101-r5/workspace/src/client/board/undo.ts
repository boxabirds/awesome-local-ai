/**
 * Undo, for one person, on a board several people are working on (story 8).
 *
 * The naive undo — step the document back one change — is destructive on a shared board: the change
 * before yours is somebody else's, and taking it back erases their work. So this controller does not
 * hold a list of document changes; it holds a list of *the changes this tab made*. Yjs's
 * `UndoManager` is asked to watch one transaction origin, {@link LOCAL_ORIGIN}, which every local
 * mutation in `board-model` is written with and nothing else is: what arrives from other people
 * comes in through the room's provider, with the provider as its origin, and what the server sent at
 * load time arrives with the load origin. Neither is ever captured, so neither is ever undone — and
 * because undoing writes an inverse into the same shared document, everyone else sees my undo the
 * same way they see anything else I do.
 *
 * Two things the manager does on its own are worth knowing about, because both look like bugs from
 * the outside and neither is:
 *
 * — **A step whose object has gone away is skipped.** Pressing undo when the newest step touched an
 *   object that somebody else has since deleted applies nothing (Yjs will not resurrect an object
 *   that the person who deleted it did not delete) and moves on to the step beneath, in the same
 *   press. Nothing visible happens for the skipped step, and no error is shown. Undoing *my own*
 *   delete does bring the object back, with the content it had at the moment I deleted it — including
 *   whatever a colleague had typed into it up to then, which is the answer the PRD asks for.
 *
 * — **A new step clears the redo stack.** That is Yjs's doing, and it is the rule in the PRD: once
 *   you have done something new, the thing you undid is no longer the future you were heading into.
 *
 * What this file adds on top of Yjs is the two things it has no notion of: a limit on how many steps
 * are remembered (`maxSteps`, trimmed from the oldest), and explicit *boundaries* — the statement
 * that this action is over and the next write begins a new step. See `undo.boundaries` in the design.
 */

import * as Y from 'yjs';

import { LOCAL_ORIGIN, OBJECTS_MAP } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * The board's own undo history. Every method is safe to call at any time: none of them throws, and
 * the two that change nothing say so by returning false.
 */
export interface UndoController {
  /** Takes the newest of this person's steps back. False when there is nothing of theirs to take. */
  undo(): boolean;
  /** Puts back the step `undo` last took. False when nothing has been undone and left standing. */
  redo(): boolean;
  /** Whether there is a step of this person's to take back. */
  canUndo(): boolean;
  /** Whether there is an undone step of this person's to put back. */
  canRedo(): boolean;
  /**
   * Ends the step that is currently being written: the next local change starts a new one.
   *
   * This is the whole of the "one action, one step" rule. A drag writes a position every animation
   * frame and a person typing writes a character at a time, and every one of those is a transaction
   * of its own; a boundary is called when the gesture or the burst is over so that they stay one
   * step, while two clicks half a second apart stay two. Calling it when nothing is being written is
   * not an error and does nothing.
   */
  boundary(): void;
  /**
   * Adds a type whose changes this history should also cover.
   *
   * Story 16 calls this with the board's comments, which are undone by the same presses as anything
   * else. It only ever widens what counts as mine-and-tracked; it cannot make a remote change appear.
   */
  addScope(type: Y.AbstractType<unknown>): void;
  /**
   * Subscribes to "the history changed": a step was added, taken, put back or dropped. Returns the
   * way to unsubscribe. This is what keeps the toolbar buttons telling the truth.
   */
  onChange(listener: () => void): () => void;
  /** Lets go of the document. Nothing after this is remembered, and nothing after this is listened
   * to — history lives in this tab only, so closing the tab is what it means to leave the board. */
  destroy(): void;
}

export interface UndoControllerOptions {
  /** Pause that ends a typing burst; defaults to {@link UNDO_CAPTURE_TIMEOUT_MS}. */
  captureTimeoutMs?: number;
  /** Steps kept before the oldest goes; defaults to {@link UNDO_MAX_STEPS}. */
  maxSteps?: number;
}

/**
 * The part of a key event these two questions are about — which is every part of one, so that a
 * browser's `KeyboardEvent` and React's synthetic event both answer it and the chord is decided in
 * exactly one place, whichever kind of listener happens to be holding the key.
 */
export interface ChordKeys {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const isZ = (event: ChordKeys): boolean => event.key === 'z' || event.key === 'Z';

/** Ctrl/Cmd+Z, and nothing else: the undo chord. */
export function isUndoChord(event: ChordKeys): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && isZ(event);
}

/**
 * The redo chord, which is two chords: Ctrl/Cmd+Shift+Z everywhere, and Ctrl+Y on the keyboards
 * whose users have never had a Shift-Z to reach for. Alt is never part of either — a chord with Alt
 * in it belongs to the operating system's own text editing.
 */
export function isRedoChord(event: ChordKeys): boolean {
  if (event.altKey) return false;
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && isZ(event)) return true;
  return event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'y' || event.key === 'Y');
}

/**
 * The undo history of one board, for one person, in this tab.
 *
 * One controller per board document: it lives as long as the document does, and a board that is
 * opened again starts with an empty history, as the PRD's `undo.session_only` asks.
 */
export function createUndo(doc: Y.Doc, options: UndoControllerOptions = {}): UndoController {
  const captureTimeoutMs = options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap(OBJECTS_MAP), {
    // The one origin this board's own writes are made with. `UndoManager` adds itself to this set,
    // which is what lets an undone step be redoable: the inverse it writes is captured into the
    // opposite stack rather than being mistaken for something new the person did.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    captureTimeout: captureTimeoutMs,
  });

  const listeners = new Set<() => void>();
  let destroyed = false;

  /** Says that the history changed, to everybody still listening. */
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /**
   * Forgets steps from the oldest end until the history fits inside `maxSteps`.
   *
   * Yjs keeps everything forever, and the array is public precisely so that a caller can decide
   * otherwise. Dropping the oldest item loses the inverse it held, which is the trade the setting
   * makes; the document itself is untouched, and so is everything younger.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) manager.undoStack.shift();
  };

  manager.on('stack-item-added', (event) => {
    // Only the undo stack is bounded. A step arriving on the redo stack is the record of an undo that
    // has already happened, and dropping it would leave an undo that could not be put back.
    if (event.type === 'undo') trim();
    notify();
  });
  // A step that merged into the one already open does not change either answer, but it does change
  // what the next undo will do, and a listener as cheap as a button re-render costs nothing.
  manager.on('stack-item-updated', notify);
  manager.on('stack-item-popped', notify);
  manager.on('stack-cleared', notify);

  const step = (direction: 'undo' | 'redo'): boolean => {
    // After `destroy` the history is over: the steps it held are gone with the board that made them,
    // and a press that arrived late must not reach a manager that has stopped watching the document.
    if (destroyed) return false;
    // Yjs returns an item only when applying the inverse actually changed the document. A step whose
    // object somebody else deleted changes nothing and returns nothing — and, as documented above,
    // this call may walk past several such steps in one press before it finds one that has an effect
    // or runs out of history. Either way the stacks have moved, so the listeners are told.
    const applied = direction === 'undo' ? manager.undo() : manager.redo();
    notify();
    return applied !== null;
  };

  return {
    undo: () => step('undo'),
    redo: () => step('redo'),
    canUndo: () => !destroyed && manager.canUndo(),
    canRedo: () => !destroyed && manager.canRedo(),
    boundary: () => {
      if (!destroyed) manager.stopCapturing();
    },
    addScope: (type) => {
      if (!destroyed) manager.addToScope(type);
    },
    onChange: (listener) => {
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      manager.destroy();
      listeners.clear();
    },
  };
}
