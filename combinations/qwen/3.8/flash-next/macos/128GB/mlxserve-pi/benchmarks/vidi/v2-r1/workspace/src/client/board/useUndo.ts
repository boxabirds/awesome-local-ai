// React binding for the per-person undo controller (`useUndo`).
//
// It subscribes with `useSyncExternalStore` — the same pattern as `useBoardDoc` —
// so the toolbar's enabled/disabled state follows the stacks without a re-render
// storm, and it hands back stable `undo`/`redo` actions. A viewer can't change
// anything, so with `canEdit` false the actions are no-ops and both flags read
// false. The button labels and order live in `UndoButtons`, not here (design).

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(
  controller: UndoController | null,
  canEdit: boolean,
): UseUndoResult {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) =>
      controller ? controller.onChange(onChange) : () => {},
    [controller],
  );

  const canUndo = useSyncExternalStore(
    subscribe,
    () => (controller ? controller.canUndo() : false),
    () => false,
  );
  const canRedo = useSyncExternalStore(
    subscribe,
    () => (controller ? controller.canRedo() : false),
    () => false,
  );

  const undo = useCallback(() => {
    if (canEdit && controller) controller.undo();
  }, [canEdit, controller]);
  const redo = useCallback(() => {
    if (canEdit && controller) controller.redo();
  }, [canEdit, controller]);

  return useMemo(
    () => ({ canUndo: canUndo && canEdit, canRedo: canRedo && canEdit, undo, redo }),
    [canUndo, canRedo, canEdit, undo, redo],
  );
}
