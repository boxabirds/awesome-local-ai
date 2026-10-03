/**
 * React binding for the UndoController (story 8, undo.controls).
 *
 * Subscribes to onChange and exposes canUndo/canRedo (gated on canEdit),
 * undo, and redo.
 */
import { useState, useEffect, useCallback } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [, setTick] = useState(0);

  useEffect(() => {
    return controller.onChange(() => setTick((t) => t + 1));
  }, [controller]);

  const canUndo = canEdit && controller.canUndo();
  const canRedo = canEdit && controller.canRedo();

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return { canUndo, canRedo, undo, redo };
}
