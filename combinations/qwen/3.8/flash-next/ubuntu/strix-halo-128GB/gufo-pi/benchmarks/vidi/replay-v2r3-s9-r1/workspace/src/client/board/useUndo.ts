/**
 * React binding for the UndoController (story 8).
 *
 * Subscribes to the controller's onChange to re-render button state.
 * Returns canUndo/canRedo (forced false when !canEdit) and undo/redo commands.
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
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    return controller.onChange(() => {
      setRevision((r) => r + 1);
    });
  }, [controller]);

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);

  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  void revision; // triggers re-render

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}
