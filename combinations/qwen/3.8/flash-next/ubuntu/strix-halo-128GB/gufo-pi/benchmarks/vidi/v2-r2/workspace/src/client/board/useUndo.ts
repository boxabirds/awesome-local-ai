import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoResult {
  const [canUndoState, setCanUndo] = useState(false);
  const [canRedoState, setCanRedo] = useState(false);

  useEffect(() => {
    if (!controller) return;
    const unsub = controller.onChange(() => {
      setCanUndo(controller.canUndo());
      setCanRedo(controller.canRedo());
    });
    // Initialize
    setCanUndo(controller.canUndo());
    setCanRedo(controller.canRedo());
    return unsub;
  }, [controller]);

  const undo = useCallback(() => {
    if (!controller || !canEdit) return;
    controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (!controller || !canEdit) return;
    controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && canUndoState,
    canRedo: canEdit && canRedoState,
    undo,
    redo,
  };
}
