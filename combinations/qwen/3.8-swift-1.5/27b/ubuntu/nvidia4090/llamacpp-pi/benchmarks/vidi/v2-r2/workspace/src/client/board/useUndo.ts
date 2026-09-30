import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

/**
 * React binding for the UndoController. Subscribes to onChange and exposes
 * canUndo/canRedo (false when !canEdit) plus undo/redo actions.
 */
export function useUndo(controller: UndoController, canEdit: boolean) {
  const [, setTick] = useState(0);

  useEffect(() => {
    return controller.onChange(() => setTick((t) => t + 1));
  }, [controller]);

  const canUndo = canEdit && controller.canUndo();
  const canRedo = canEdit && controller.canRedo();

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.redo();
  }, [controller, canEdit]);

  return { canUndo, canRedo, undo, redo };
}
