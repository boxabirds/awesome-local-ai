/**
 * React binding for the per-user undo controller (story 8). Subscribes to
 * stack changes and exposes stable canUndo/canRedo flags and actions for
 * toolbar buttons and shortcuts.
 *
 * The flags and actions are masked by `canEdit`: a load-failed board
 * (canEdit false) exposes no undo/redo at all (undo.controls).
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

/**
 * The undo/redo binding exposed to controls.
 */
export interface UndoBinding {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * Bind controls to an undo controller. Accepts `null` while no controller
 * exists yet (before the board doc effect runs) — that behaves like an
 * empty history.
 */
export function useUndo(controller: UndoController | null, canEdit: boolean): UndoBinding {
  const subscribe = useCallback(
    (cb: () => void) => (controller ? controller.onChange(cb) : () => {}),
    [controller],
  );
  const hasUndo = useSyncExternalStore(subscribe, () => controller?.canUndo() ?? false);
  const hasRedo = useSyncExternalStore(subscribe, () => controller?.canRedo() ?? false);
  const undo = useCallback(() => {
    if (canEdit) controller?.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller?.redo();
  }, [controller, canEdit]);
  return {
    canUndo: canEdit && hasUndo,
    canRedo: canEdit && hasRedo,
    undo,
    redo,
  };
}
