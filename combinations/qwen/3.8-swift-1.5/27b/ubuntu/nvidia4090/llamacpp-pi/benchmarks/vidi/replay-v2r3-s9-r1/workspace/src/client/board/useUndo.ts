/**
 * React binding for the per-client undo history (story 8).
 *
 * Subscribes to the controller's history changes with
 * `useSyncExternalStore` (a tiny numeric snapshot keeps re-renders to the
 * exact moments canUndo/canRedo flip) and gates everything on `canEdit`:
 * a read-only board (e.g. a failed load, story 4) exposes no undo/redo.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

export interface UndoControls {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoControls {
  const subscribe = useCallback(
    (cb: () => void) => controller.onChange(cb),
    [controller],
  );
  const getSnapshot = useCallback(
    () => (controller.canUndo() ? 1 : 0) | (controller.canRedo() ? 2 : 0),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot);
  return {
    canUndo: canEdit && (state & 1) !== 0,
    canRedo: canEdit && (state & 2) !== 0,
    undo: () => {
      if (canEdit) controller.undo();
    },
    redo: () => {
      if (canEdit) controller.redo();
    },
  };
}
