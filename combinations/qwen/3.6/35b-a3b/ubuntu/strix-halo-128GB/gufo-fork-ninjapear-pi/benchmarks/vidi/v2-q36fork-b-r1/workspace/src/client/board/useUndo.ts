import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React hook that binds an UndoController to local state for rendering.
 * Returns false for canUndo/canRedo when !canEdit (edit lock).
 */
export function useUndo(
  controller: UndoController | null,
  canEdit: boolean,
): UseUndoResult {
  const [state, setState] = useState({
    canUndo: false,
    canRedo: false,
  });

  useEffect(() => {
    if (!controller) {
      setState({ canUndo: false, canRedo: false });
      return;
    }

    // Update immediately with current state
    const update = () => {
      setState({
        canUndo: canEdit && controller.canUndo(),
        canRedo: canEdit && controller.canRedo(),
      });
    };

    update();
    const unsubscribe = controller.onChange(update);
    return unsubscribe;
  }, [controller, canEdit]);

  const undo = useCallback(() => {
    if (!controller || !controller.canUndo()) return;
    controller.undo();
  }, [controller]);

  const redo = useCallback(() => {
    if (!controller || !controller.canRedo()) return;
    controller.redo();
  }, [controller]);

  return { canUndo: state.canUndo, canRedo: state.canRedo, undo, redo };
}
