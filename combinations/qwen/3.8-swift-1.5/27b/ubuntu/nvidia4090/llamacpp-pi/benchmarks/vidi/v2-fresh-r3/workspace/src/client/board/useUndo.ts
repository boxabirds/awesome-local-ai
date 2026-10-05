import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React binding for the UndoController: subscribes to change notifications
 * and exposes canUndo/canRedo/undo/redo, respecting the board edit lock.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    return controller.onChange(() => setTick((t) => t + 1));
  }, [controller]);

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.redo();
  }, [controller, canEdit]);

  const canUndoState = canEdit && controller.canUndo();
  const canRedoState = canEdit && controller.canRedo();

  return {
    canUndo: canUndoState,
    canRedo: canRedoState,
    undo,
    redo,
  };
}
