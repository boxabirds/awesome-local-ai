import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NO_UNDO, type UndoController } from './undo';

/** The board's controller for components (the text editor) that sit far from App. */
export const UndoContext = createContext<UndoController>(NO_UNDO);
export const useUndoController = () => useContext(UndoContext);

export function useUndo(
  controller: UndoController,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const [, force] = useState(0);
  useEffect(() => {
    force((n) => n + 1);
    return controller.onChange(() => force((n) => n + 1));
  }, [controller]);
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && controller.canUndo(), canRedo: canEdit && controller.canRedo(), undo, redo };
}
