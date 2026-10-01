import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React binding for the UndoController. Exposes canUndo/canRedo for button state,
 * and undo/redo functions. Returns false for both when canEdit is false.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [canUndoState, setCanUndo] = useState(controller.canUndo());
  const [canRedoState, setCanRedo] = useState(controller.canRedo());

  useEffect(() => {
    const unsub = controller.onChange(() => {
      setCanUndo(controller.canUndo());
      setCanRedo(controller.canRedo());
    });
    // Sync initial state (in case changes happened between render and effect)
    setCanUndo(controller.canUndo());
    setCanRedo(controller.canRedo());
    return unsub;
  }, [controller]);

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && canUndoState,
    canRedo: canEdit && canRedoState,
    undo,
    redo,
  };
}
