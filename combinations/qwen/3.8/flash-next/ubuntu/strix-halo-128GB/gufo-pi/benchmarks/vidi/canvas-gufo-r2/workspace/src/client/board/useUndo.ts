/**
 * React binding for UndoController (story 8, undo.controls).
 * Exposes canUndo, canRedo, undo, redo to UI components.
 */
import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    function update() {
      setCanUndo(canEdit && controller.canUndo());
      setCanRedo(canEdit && controller.canRedo());
    }
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
