import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../shared/config';

/**
 * One person's undo history for one board (anchor `undo.history`).
 *
 * A `Y.UndoManager` over the board's `objects` map that tracks
 * **`LOCAL_ORIGIN` only** - the origin every mutation in
 * `src/shared/board-model.ts` writes with (story 2). That one filter is what
 * makes this undo personal rather than destructive (Key decision 1):
 *
 * | where a change came from | its transaction origin | captured? |
 * |---|---|---|
 * | this tab's own editing | `LOCAL_ORIGIN` | **yes** |
 * | another person's editing, through the room | the provider | no |
 * | this board being loaded out of storage (story 4) | `LOAD_ORIGIN` | no |
 *
 * So the stacks hold exclusively this person's steps, and five simultaneous
 * editors each have their own controller in their own tab: undoing here cannot
 * reach anything anyone else did. Nothing is stored - the history lives in this
 * tab's memory and is gone on reload (`undo.session_only`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Empty
 *     Empty --> UndoOnly : local step captured
 *     UndoOnly --> UndoOnly : local step captured, trims beyond maxSteps
 *     UndoOnly --> Both : undo with steps remaining
 *     UndoOnly --> RedoOnly : undo last step
 *     Both --> Both : undo or redo with steps on both stacks
 *     Both --> RedoOnly : undo last undo step
 *     Both --> UndoOnly : redo last redo step, or a new local step clears redo
 *     RedoOnly --> UndoOnly : redo, or a new local step clears redo
 *     UndoOnly --> Empty : destroy()
 *     Both --> Empty : destroy()
 *     RedoOnly --> Empty : destroy()
 * ```
 *
 * The capture window (`undo.steps`, `undo.typing`) is the manager's own: local
 * transactions less than `captureTimeoutMs` apart join the current step, and
 * `boundary()` closes it. Gestures and editing call `boundary()` at both ends,
 * so the animation frames of one drag join into one step while two separate
 * actions never do.
 */
export interface UndoController {
  /**
   * Reverse this person's last own step: exactly one stack item, even when that
   * step had nothing left to reverse. `false` when there is no step.
   */
  undo(): boolean;
  /** Re-apply the last undone step. `false` when there is none. */
  redo(): boolean;
  /** Close the current capture window: the next change starts a new step. */
  boundary(): void;
  /**
   * Hold one step open for the length of one action (`undo.steps`).
   *
   * `group(true)` opens it, `group(false)` closes it. A gesture writes once per
   * animation frame, and a slow drag can easily take longer than the typing
   * window - without this it would come back as several steps. Inside a group
   * every local write joins the same step however long it takes, so one drag is
   * one undo.
   */
  group(open: boolean): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Extend what this history covers (story 16 adds `comments`). */
  addScope(type: Y.AbstractType<unknown>): void;
  /** Notified whenever the stacks change; returns the unsubscribe. */
  onChange(callback: () => void): () => void;
  /** Stop observing the document (history is session-only). */
  destroy(): void;
}

export interface UndoOptions {
  /** Typing pause that ends a step. Defaults to `UNDO_CAPTURE_TIMEOUT_MS`. */
  captureTimeoutMs?: number;
  /** Steps to keep. Defaults to `UNDO_MAX_STEPS`. */
  maxSteps?: number;
}

type Stack = 'undo' | 'redo';

/**
 * Apply **exactly one** stack item per press (`undo.safe`).
 *
 * `Y.UndoManager.undo()` keeps popping until a pop changes something, which is
 * not what a person pressing undo expects, and it is dangerous here: if the top
 * step moved an object someone else deleted, Yjs silently walks further back and
 * reverses *earlier* steps too - undoing my move would then delete a note I
 * never deleted. Handing the manager a stack that holds only its top item makes
 * the loop stop after one step, whatever it did, and the rest of the history is
 * put back untouched.
 *
 * A step whose object is gone therefore consumes itself: nothing visible, no
 * error, and the next press continues normally (TC-07, TC-23). The press still
 * counts as a step, which is what the caller is told - and what the buttons
 * need to know, because a press that changed nothing fires no Yjs event.
 */
function popOneStep(manager: Y.UndoManager, which: Stack): boolean {
  const stack = which === 'undo' ? manager.undoStack : manager.redoStack;
  if (stack.length === 0) {
    return false;
  }
  const top = stack[stack.length - 1]!;
  const rest = stack.slice(0, stack.length - 1);
  if (which === 'undo') {
    manager.undoStack = [top];
  } else {
    manager.redoStack = [top];
  }
  try {
    if (which === 'undo') {
      manager.undo();
    } else {
      manager.redo();
    }
  } finally {
    // Everything below the top step is still this person's history.
    if (which === 'undo') {
      manager.undoStack = rest;
    } else {
      manager.redoStack = rest;
    }
  }
  // One stack item was taken, whether or not it had anything left to reverse.
  return true;
}

/**
 * Create the history for one board document.
 *
 * One controller per board per tab: `BoardView` makes it when the board mounts
 * and destroys it when the board changes or the page unmounts.
 */
export function createUndo(doc: Y.Doc, opts: UndoOptions = {}): UndoController {
  const captureTimeoutMs = opts.captureTimeoutMs ?? UNDO_CAPTURE_TIMEOUT_MS;
  const maxSteps = opts.maxSteps ?? UNDO_MAX_STEPS;

  const manager = new Y.UndoManager(doc.getMap<unknown>('objects'), {
    captureTimeout: captureTimeoutMs,
    // Only this tab's own transactions (`undo.own`). The manager adds itself to
    // this set so that its own inverse transactions land on the opposite stack.
    trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
  });

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** `undo.limit`: a step beyond the limit drops the oldest one. */
  const trim = (): void => {
    // Never while a step is mid-flight: the stacks are being worked on.
    if (manager.undoing || manager.redoing) {
      return;
    }
    while (manager.undoStack.length > maxSteps) {
      manager.undoStack.shift();
    }
  };

  const onStackChange = (): void => {
    trim();
    notify();
  };

  manager.on('stack-item-added', onStackChange);
  manager.on('stack-item-updated', onStackChange);
  manager.on('stack-item-popped', onStackChange);
  manager.on('stack-cleared', onStackChange);

  let destroyed = false;

  /**
   * One press of undo or redo: consume a step, then say so.
   *
   * Yjs fires `stack-item-popped` only for a step that changed something, so a
   * step that had nothing left to reverse would leave every listener - the
   * toolbar buttons above all - showing the state from before the press.
   */
  const take = (which: Stack): boolean => {
    const consumed = popOneStep(manager, which);
    if (consumed) {
      notify();
    }
    return consumed;
  };

  const controller: UndoController = {
    undo(): boolean {
      if (destroyed) {
        return false;
      }
      return take('undo');
    },
    redo(): boolean {
      if (destroyed) {
        return false;
      }
      return take('redo');
    },
    boundary(): void {
      if (destroyed) {
        return;
      }
      // Defensive: a boundary also repairs a group that was never closed.
      manager.captureTimeout = captureTimeoutMs;
      manager.stopCapturing();
    },
    group(open: boolean): void {
      if (destroyed) {
        return;
      }
      if (open) {
        // The action starts a step of its own, and nothing joins it from
        // outside: the window is open until the action ends.
        manager.stopCapturing();
        manager.captureTimeout = Number.POSITIVE_INFINITY;
      } else {
        manager.captureTimeout = captureTimeoutMs;
        manager.stopCapturing();
      }
    },
    canUndo(): boolean {
      return !destroyed && manager.canUndo();
    },
    canRedo(): boolean {
      return !destroyed && manager.canRedo();
    },
    addScope(type: Y.AbstractType<unknown>): void {
      if (!destroyed) {
        manager.addToScope(type);
      }
    },
    onChange(callback: () => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy(): void {
      if (destroyed) {
        return;
      }
      destroyed = true;
      listeners.clear();
      manager.destroy();
    },
  };

  return controller;
}
