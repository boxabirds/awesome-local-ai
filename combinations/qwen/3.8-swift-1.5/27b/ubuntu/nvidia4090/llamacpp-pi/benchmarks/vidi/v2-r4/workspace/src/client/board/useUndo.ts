import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
}

/**
 * React binding for a per-user undo controller (story 8).
 *
 * Subscribes to the controller's change notifications so `canUndo`/`canRedo`
 * stay fresh for button state, and exposes stable undo/redo/boundary actions.
 */
export function useUndo(controller: UndoController | null): UseUndoResult {
  // Bumped on every stack change (item added or popped) to re-read the stacks
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!controller) return;
    return controller.onChange(() => setVersion((v) => v + 1));
  }, [controller]);

  const canUndo = controller?.canUndo() ?? false;
  const canRedo = controller?.canRedo() ?? false;

  const undo = useCallback(() => controller?.undo() ?? false, [controller]);
  const redo = useCallback(() => controller?.redo() ?? false, [controller]);
  const boundary = useCallback(() => {
    controller?.boundary();
  }, [controller]);

  return { canUndo, canRedo, undo, redo, boundary };
}
