/**
 * Story 8: undo.controls — React binding for one tab's UndoController.
 *
 * Re-renders on stack changes (onChange) and gates everything on `canEdit`
 * (a load-failed board is read-only: undo/redo are unavailable,
 * undo.not_editable). The buttons and shortcuts only ever call THIS tab's
 * controller, whose stacks hold only this person's LOCAL_ORIGIN steps
 * (personal scope, undo.own / undo.redo).
 */
import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [version, setVersion] = useState(0);
  useEffect(() => controller.onChange(() => setVersion((v) => v + 1)), [controller]);
  // `version` is only a re-render trigger for stack changes.
  void version;

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}
