// React binding for the per-user UndoController (see spec: undo.controls).
//
// `canUndo`/`canRedo` are false while the board cannot be edited (story 4
// load_failed, undo.not_editable); actions are ignored in that state. The
// button state re-renders on the controller's onChange subscription.

import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UndoUi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoUi {
  const [stacks, setStacks] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
  }));

  useEffect(
    () =>
      controller.onChange(() => {
        setStacks({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
      }),
    [controller],
  );

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && stacks.canUndo,
    canRedo: canEdit && stacks.canRedo,
    undo,
    redo,
  };
}
