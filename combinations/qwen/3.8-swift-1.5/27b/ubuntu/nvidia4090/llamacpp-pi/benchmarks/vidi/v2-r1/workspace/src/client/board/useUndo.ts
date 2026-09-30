import { useState, useEffect, useCallback } from 'react';
import type { UndoController } from './undo';

/**
 * Story 8: React hook binding the UndoController to render state.
 * Exposes canUndo/canRedo (false when !canEdit), and undo/redo actions.
 */
export function useUndo(controller: UndoController, canEdit: boolean) {
  const [canUndo, setCanUndo] = useState(() => canEdit && controller.canUndo());
  const [canRedo, setCanRedo] = useState(() => canEdit && controller.canRedo());

  useEffect(() => {
    const update = () => {
      setCanUndo(canEdit && controller.canUndo());
      setCanRedo(canEdit && controller.canRedo());
    };
    update();
    return controller.onChange(update);
  }, [controller, canEdit]);

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
