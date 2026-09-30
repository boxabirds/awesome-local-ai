/**
 * React binding for the UndoController (story 8).
 *
 * Subscribes to stack-state changes and exposes canUndo, canRedo, undo, redo.
 * When canEdit is false (e.g., board load failed), both operations are suppressed
 * and buttons show as disabled.
 */

import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoResult {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!controller) return undefined;
    return controller.onChange(forceUpdate);
  }, [controller]);

  const undo = useCallback(() => {
    if (!controller || !canEdit) return;
    controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (!controller || !canEdit) return;
    controller.redo();
  }, [controller, canEdit]);

  const canUndo = canEdit && (controller?.canUndo() ?? false);
  const canRedo = canEdit && (controller?.canRedo() ?? false);

  return useMemo(() => ({ canUndo, canRedo, undo, redo }), [canUndo, canRedo, undo, redo]);
}
