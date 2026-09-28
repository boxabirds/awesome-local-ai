import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React binding for the UndoController.
 * Subscribes to onChange and exposes canUndo/canRedo (false when !canEdit), undo, redo.
 */
export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoResult {
  const [canUndoState, setCanUndo] = useState(false);
  const [canRedoState, setCanRedo] = useState(false);

  useEffect(() => {
    if (!controller) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const update = () => {
      setCanUndo(controller.canUndo());
      setCanRedo(controller.canRedo());
    };
    update();
    return controller.onChange(update);
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
    canUndo: canEdit ? canUndoState : false,
    canRedo: canEdit ? canRedoState : false,
    undo,
    redo,
  };
}
