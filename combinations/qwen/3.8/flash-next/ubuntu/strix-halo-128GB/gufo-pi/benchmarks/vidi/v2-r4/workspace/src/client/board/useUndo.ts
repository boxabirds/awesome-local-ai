/**
 * useUndo: React binding for the UndoController.
 * Subscribes to stack changes and exposes canUndo/canRedo/undo/redo.
 */
import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoResult {
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (!controller) return;
    const unsub = controller.onChange(() => {
      setState({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    });
    // Sync initial state
    setState({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    return unsub;
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
    canUndo: canEdit && state.canUndo,
    canRedo: canEdit && state.canRedo,
    undo,
    redo,
  };
}
