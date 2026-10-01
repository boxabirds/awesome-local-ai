// src/client/board/useUndo.ts
// React binding to the per-client UndoController (story 8).
// Exposes canUndo/canRedo (false when the board cannot be edited) and
// undo/redo actions. Buttons and shortcuts only ever call this tab's
// controller, whose stacks hold only this person's own LOCAL_ORIGIN steps.

import { useCallback, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  const getState = useCallback(
    () => (controller.canUndo() ? 2 : 0) | (controller.canRedo() ? 1 : 0),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, getState);

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && (state & 2) !== 0,
    canRedo: canEdit && (state & 1) !== 0,
    undo,
    redo,
  };
}
