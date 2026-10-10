// React binding over the undo controller (undo.controls): re-renders on
// stack events, and reports both flags false while editing is locked so a
// load-failed board shows disabled buttons and ignores the shortcuts.

import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [state, setState] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
  }));

  useEffect(() => {
    const refresh = (): void => {
      setState({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    };
    refresh();
    return controller.onChange(refresh);
  }, [controller]);

  // The stacks only ever hold this tab's LOCAL_ORIGIN steps (personal
  // scope); while editing is locked the commands do nothing.
  const undo = useCallback((): void => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback((): void => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && state.canUndo,
    canRedo: canEdit && state.canRedo,
    undo,
    redo,
  };
}
