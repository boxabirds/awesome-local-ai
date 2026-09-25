import { useEffect, useState } from 'react';
import type { UndoController } from './undo';

/**
 * Undo state for the UI (story 8, undo.controls).
 *
 * Subscribes to the controller's `onChange` so the toolbar buttons re-render
 * as the stacks change. `canUndo`/`canRedo` are false while the board is
 * locked (`canEdit === false`, persist.client_status) and `undo`/`redo` are
 * no-ops then; the buttons call only this tab's controller, whose stacks hold
 * only this person's LOCAL_ORIGIN steps (personal scope).
 */
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [stacks, setStacks] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
  }));

  useEffect(() => {
    return controller.onChange(() => {
      setStacks({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    });
  }, [controller]);

  return {
    canUndo: canEdit && stacks.canUndo,
    canRedo: canEdit && stacks.canRedo,
    undo: () => {
      if (canEdit) controller.undo();
    },
    redo: () => {
      if (canEdit) controller.redo();
    },
  };
}
