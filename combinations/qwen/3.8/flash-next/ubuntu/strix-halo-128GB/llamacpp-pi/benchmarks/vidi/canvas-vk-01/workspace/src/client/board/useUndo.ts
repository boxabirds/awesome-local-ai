import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React binding for the UndoController. Exposes reactive canUndo/canRedo state
 * and undo/redo actions that are no-ops when editing is locked.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    const unsub = controller.onChange(() => {
      setState({
        canUndo: canEdit && controller.canUndo(),
        canRedo: canEdit && controller.canRedo(),
      });
    });
    // Initial state
    setState({
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
    });
    return unsub;
  }, [controller, canEdit]);

  // Re-sync when canEdit changes (e.g. board load fails mid-session)
  useEffect(() => {
    setState({
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
    });
  }, [canEdit, controller]);

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return { canUndo: state.canUndo, canRedo: state.canRedo, undo, redo };
}
