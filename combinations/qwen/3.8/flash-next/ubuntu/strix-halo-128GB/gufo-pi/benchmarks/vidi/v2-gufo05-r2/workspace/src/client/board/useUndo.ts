/**
 * Story 8: the React bindings for the undo controller.
 *
 * `useUndo` turns the controller's stack state into the `canUndo` / `canRedo`
 * the toolbar buttons need and re-renders whenever the stacks change.
 * `UndoControllerContext` carries the one controller for this board down to the
 * pieces that must close a capture window or answer Ctrl/Cmd+Z themselves — the
 * sticky text editor and the selection bar — without threading it through every
 * object component.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import type { UndoController } from './undo';

export interface UndoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * The undo/redo state for the toolbar and the keyboard, from one controller.
 *
 * A board that cannot be edited (story 4's load-failed lock) reports both stacks
 * empty, so the buttons are disabled and nothing this person does is offered for
 * undo while the board is not really there (PRD undo.not_editable).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [, bump] = useState(0);
  useEffect(() => controller.onChange(() => bump((n) => n + 1)), [controller]);

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);
  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}

/**
 * The controller for the board this subtree is showing, or null when there is
 * none (a component rendered outside a board). Deep components reach for it to
 * close a capture window at an editing boundary or to undo inside a text field.
 */
export const UndoControllerContext = createContext<UndoController | null>(null);

/** The controller for this board, or null. */
export function useUndoController(): UndoController | null {
  return useContext(UndoControllerContext);
}
