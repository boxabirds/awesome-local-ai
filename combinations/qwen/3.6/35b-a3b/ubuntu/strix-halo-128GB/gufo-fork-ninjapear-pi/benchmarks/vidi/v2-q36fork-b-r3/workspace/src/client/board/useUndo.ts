import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UndoController } from './undo';

interface UseUndoReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * React binding for an UndoController.
 * When `canEdit` is false (load failed), returns disabled state.
 */
export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoReturn {
  const [, forceRender] = useState(0);

  // Subscribe to controller change events
  useEffect(() => {
    if (!controller) return;
    const unsub = controller.onChange(() => {
      forceRender((n) => n + 1);
    });
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

  const canUndo = useMemo(
    () => (controller && canEdit ? controller.canUndo() : false),
    [controller, canEdit],
  );

  const canRedo = useMemo(
    () => (controller && canEdit ? controller.canRedo() : false),
    [controller, canEdit],
  );

  return { canUndo, canRedo, undo, redo };
}
