// React binding for this tab's undo history (story 8, undo.controls).
//
// The stacks live in the controller, outside React, so the hook's whole job is to
// make their state visible: it subscribes to the controller's own announcement and
// re-renders whenever a step is captured, consumed or cleared. Nothing polls and
// nothing is cached from a render - a button that remembered the past would keep
// an "Undo" that does nothing.
//
// `canEdit` is the story 4 lock, and it is applied HERE rather than only at the
// buttons: on a board this client could not load there is nothing it may change,
// so the honest answer about its history is that there is nothing to undo, even
// though the steps it made before the load failed are still sitting in memory.
//
// The history itself is per tab and per board: this hook never sees another
// person's steps, because the controller it is given tracks only this tab's own
// transactions.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UndoController } from './undo.ts';

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [version, bump] = useState(0);

  useEffect(() => controller.onChange(() => bump((n) => n + 1)), [controller]);

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);

  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  return useMemo<UndoState>(
    () => ({
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
      undo,
      redo,
    }),
    // `version` is the history changing underneath us; it has no other use here.
    [canEdit, controller, version, undo, redo],
  );
}

// The controller, for the surfaces that sit below the board and cannot be handed
// it as a prop - the sticky note's text editor, which lives inside an object
// component that every object type renders with the same props.
export const UndoContext = createContext<UndoController | null>(null);

/** This tab's undo history, or null outside a board. */
export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}
