import { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import type { UndoController } from './undo';

/**
 * The undo controls of the toolbar and the keyboard shortcuts both need the same thing:
 * whether there is anything to undo or redo right now, and the two actions. This hook is the
 * only place that asks, so a button cannot disagree with a shortcut (`undo.buttons`).
 *
 * A person who cannot edit cannot undo: the buttons are disabled and the shortcuts do
 * nothing, because undo takes the board back to a state this client refuses to write.
 */
export interface UndoButtonState {
  /** Whether the Undo button is enabled. */
  canUndo: boolean;
  /** Whether the Redo button is enabled. */
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * The current undo state of one board.
 *
 * `canUndo`/`canRedo` are read from the controller on every render, and the controller's
 * change events are what re-render: nothing else knows how many steps there are.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoButtonState {
  const [ , bumped ] = useReducer((renders: number) => renders + 1, 0);

  useEffect(() => controller.onChange(bumped), [ controller ]);

  const undo = useCallback(() => {
    controller.undo();
  }, [ controller ]);
  const redo = useCallback(() => {
    controller.redo();
  }, [ controller ]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}

/**
 * The history of the board this component is on. Objects are rendered by the registry, which
 * takes the fixed `ObjectProps` of story 7, so an object that edits text reaches the history
 * through here instead of through another prop. `null` off a board, where there is no history
 * to speak of.
 */
export const UndoContext = createContext<UndoController | null>(null);

/** The history of this board, or `null` outside one. */
export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}
