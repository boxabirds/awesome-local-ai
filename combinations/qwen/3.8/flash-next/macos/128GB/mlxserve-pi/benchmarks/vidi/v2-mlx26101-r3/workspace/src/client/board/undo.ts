import * as Y from 'yjs';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';
import { LOCAL_ORIGIN, OBJECTS_MAP } from '../../shared/board-model';

/**
 * One person's undo history (story 8).
 *
 * This is the whole of the per-user part of undo: a `Y.UndoManager` that watches the objects map
 * and is told to remember only the transactions this tab made itself. Everything the board does
 * goes through the board model, which tags every one of its transactions with `LOCAL_ORIGIN`, so
 * that one `trackedOrigins` set says "mine" - and everything that arrives from anyone else, from
 * the socket, arrives with the socket as its origin and is never remembered here.
 *
 * Undo therefore does not wind the board back to how it looked. It applies the inverse of one of
 * my own changes as a *new* transaction, which then syncs to everyone like any other change. That
 * is the only way undo can be a collaborative operation: an update carries state, not intent, so
 * a change that arrived from a peer is not "an operation of type move" for me to cancel - it is
 * simply part of the document, and there is nothing to undo.
 *
 * ```text
 * my transaction (LOCAL_ORIGIN) --> captured into the undo stack
 * peer update      (the socket) --> not captured; it is part of the board now
 * undo / redo      (the manager) --> captured into the other stack, so it goes both ways
 * ```
 */
export interface UndoController {
  /** Wind back the last of my own steps. False when there is nothing of mine to wind back. */
  undo(): boolean;
  /** Put back the last step I undid. False when I have not undone anything since. */
  redo(): boolean;
  /**
   * End the current step here: the next change starts a new one.
   *
   * The name says what it is for. A person dragging nine notes is making sixty writes that belong
   * to one action, and a person typing is making one write per keystroke that belongs to one
   * edit; both are runs that the capture timeout alone would group wrongly, so the code that knows
   * where an action begins and ends says so at the boundary.
   */
  boundary(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Watch another type for undoable changes. Story 8 needs only the objects map, but the types
   * stories 9-12 add may keep their data somewhere else, and an object type must not have to
   * reach in here to be undoable.
   */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Listen for the stacks changing; returns the way to stop listening. */
  onChange(listener: () => void): () => void;
  /** Stop watching the document. The history goes with it: undo is session-only. */
  destroy(): void;
}

export interface UndoOptions {
  /** Defaults to `UNDO_CAPTURE_TIMEOUT_MS`; tests pass their own to be exact about timing. */
  captureTimeoutMs?: number;
  /** Defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

/**
 * The undo history of one board document, for one person.
 *
 * One of these per open document, created with it and destroyed with it. Nothing here is stored
 * anywhere: reload the page and the history is gone, which is the specification's
 * `undo.session_only`, and also the only sane answer when the document you are undoing in is one
 * of several copies that other people are editing.
 */
export function createUndo(doc: Y.Doc, options: UndoOptions = {}): UndoController {
  const captureTimeoutMs = options.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = options.maxSteps ?? UNDO_MAX_STEPS;

  /**
   * The scope is the objects map, so a change to anything inside an object - its place, its size,
   * its colour, the text inside it - is a change this can undo. `trackedOrigins` is given as a
   * fresh set because `Y.UndoManager` adds itself to the set it is handed, so sharing one would
   * make every manager track every other manager's changes.
   */
  const manager = new Y.UndoManager(doc.getMap<Y.Map<unknown>>(OBJECTS_MAP), {
    captureTimeout: captureTimeoutMs,
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();
  let destroyed = false;
  /**
   * How deep inside a step this is. See `oneStep`: while a step is being taken the stacks are not
   * in the state anybody would describe as "what the history looks like", and a listener that is
   * told about it at that moment - which is what yjs does, from the middle of the change - reads
   * an undo stack that has been emptied and shows a button that is disabled until something else
   * happens to redraw it. So nothing is said while a step is in progress, and everything is said
   * once, when it is over.
   */
  let stepping = 0;

  const notify = (): void => {
    if (stepping > 0) {
      return;
    }
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /**
   * Keep the history inside `UNDO_MAX_STEPS`.
   *
   * The oldest step is dropped, and with it the only thing that said how to put that change back.
   * A long session therefore loses the beginning of itself rather than growing without limit;
   * everything still on the board is untouched, because undo never rewinds the document, it writes
   * an inverse.
   */
  const trim = (): void => {
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
  };

  /**
   * Take one step, and only one.
   *
   * `UndoManager.undo()` does not stop at the top of the stack. When the change it is trying to
   * reverse lands on something that is no longer there - a note a peer deleted while my history
   * was full of moving it - it takes that step out, finds it changed nothing, and goes on to the
   * step underneath, so one press of undo silently reverts a change from further back that nobody
   * asked it to touch. The rest of the stack is therefore put aside while one step is taken, and
   * put back afterwards: that is what keeps the promise that undo affects exactly the change on
   * top of the history. `redo()` behaves the same way and is treated the same.
   *
   * The stack is mutated in place, which is the array the manager reads out of on every step.
   */
  const oneStep = <T>(stack: T[], run: () => void, trimAfter: boolean): void => {
    const below = stack.splice(0, Math.max(0, stack.length - 1));
    stepping += 1;
    try {
      run();
    } finally {
      // Whatever the step left in the stack goes on top of the steps it never got to.
      if (below.length > 0) {
        stack.unshift(...below);
      }
      if (trimAfter) {
        trim();
      }
      stepping -= 1;
      // The one time the listeners hear about this step: after it, with the history as it now is.
      notify();
    }
  };

  /**
   * Both stacks are reported by the same events, and both are what the toolbar buttons read, so
   * one listener covers both. A new change also empties the redo stack here: the manager clears it
   * in the same transaction that adds the new undo step, and that emits the add event too.
   */
  const onStack = (): void => {
    if (!destroyed) {
      trim();
      notify();
    }
  };
  manager.on('stack-item-added', () => {
    onStack();
  });
  manager.on('stack-item-popped', () => {
    onStack();
  });

  return {
    // Whether there was a step to wind back is asked of the stack before the wind, not read off
    // what yjs hands back afterwards: what the caller wants to know is whether anything of mine
    // went back, and an empty stack is the one case that has to be answered honestly.
    undo() {
      if (destroyed || !manager.canUndo()) {
        return false;
      }
      oneStep(manager.undoStack, () => manager.undo(), true);
      return true;
    },
    redo() {
      if (destroyed || !manager.canRedo()) {
        return false;
      }
      oneStep(manager.redoStack, () => manager.redo(), false);
      return true;
    },
    boundary() {
      if (!destroyed) {
        manager.stopCapturing();
      }
    },
    canUndo() {
      return !destroyed && manager.canUndo();
    },
    canRedo() {
      return !destroyed && manager.canRedo();
    },
    addScope(type) {
      if (!destroyed) {
        manager.addToScope(type);
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      manager.destroy();
      listeners.clear();
    },
  };
}
