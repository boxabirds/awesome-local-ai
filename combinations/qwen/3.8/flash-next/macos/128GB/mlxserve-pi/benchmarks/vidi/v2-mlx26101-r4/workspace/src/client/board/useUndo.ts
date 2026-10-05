/**
 * The board's undo history, as React wants it.
 *
 * There is very little here, and that is the point: the history itself lives in `undo.ts`, over the
 * document, and knows nothing about rendering. What this file adds is the one thing a component cannot
 * do for itself — noticing when the answer to "is there anything to undo?" changes. A colleague's change,
 * a frame of a drag, a keystroke in another tab: any of those can be the moment a disabled button becomes
 * an enabled one, and none of them is a reason this component re-renders.
 *
 * So the controller is asked to say the word again, and the word is the same one it would have said had
 * anything asked: `canUndo()` and `canRedo()` are read when the component is drawn, which is what keeps
 * this honest. There is no copy of the history here, and no version of the board to compare — a component
 * that drew from a cached number would be one re-render behind the board it was drawn on.
 */
import { useCallback, useEffect, useReducer } from 'react';

import type { UndoActions, UndoController } from './undo';

export interface UndoBinding extends UndoActions {
  /** Whether there is one of my own changes to undo. */
  canUndo: boolean;
  /** Whether there is one of my own undone changes to put back. */
  canRedo: boolean;
  /** Whether this board may be written to, which is the other half of whether undo is on offer. */
  canEdit: boolean;
}

/**
 * The undo history of this board, as it looks to the person sitting at this keyboard.
 *
 * `canEdit` is passed through rather than applied: this hook reports what the history holds and what the
 * board allows, and the decision not to offer a command that goes nowhere is made where the command is
 * offered — in the buttons, which disable themselves, and in the shortcuts, which stand aside. Undoing is
 * not a write that needs permission twice; it is a write like any other, and it is refused like any other.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoBinding {
  const [, redraw] = useReducer((count: number) => count + 1, 0);

  // The history is the controller's, so this listens to it rather than to the document: the document
  // changes on every remote keystroke and would redraw a button for no reason at all.
  useEffect(() => controller.onChange(redraw), [controller]);

  // Read at draw time, so what is on screen is what the history holds at that moment.
  const canUndo = controller.canUndo();
  const canRedo = controller.canRedo();

  const undo = useCallback((): void => {
    controller.undo();
  }, [controller]);

  const redo = useCallback((): void => {
    controller.redo();
  }, [controller]);

  const boundary = useCallback((): void => {
    controller.boundary();
  }, [controller]);

  return { canUndo, canRedo, canEdit, undo, redo, boundary };
}
