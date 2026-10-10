import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UndoController } from './undo';

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

// React binding for the tab's UndoController. Stack availability is folded
// with the story 4 edit lock, so a load-failed board reports nothing to undo
// and its buttons are disabled.
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [stacks, setStacks] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo()
  }));

  useEffect(() => {
    const sync = () => setStacks({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    sync();
    return controller.onChange(sync);
  }, [controller]);

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);
  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  return useMemo(
    () => ({
      canUndo: canEdit && stacks.canUndo,
      canRedo: canEdit && stacks.canRedo,
      undo,
      redo
    }),
    [canEdit, stacks, undo, redo]
  );
}
