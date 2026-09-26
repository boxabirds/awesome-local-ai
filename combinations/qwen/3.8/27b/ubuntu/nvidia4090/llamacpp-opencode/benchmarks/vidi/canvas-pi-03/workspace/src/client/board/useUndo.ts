import { useCallback, useEffect, useReducer } from 'react';
import type { UndoController } from './undo';

export interface UndoState {
  /** True when this person has at least one own step to undo (and can edit). */
  canUndo: boolean;
  /** True when this person has an undone step to re-apply (and can edit). */
  canRedo: boolean;
  /** Undoes this tab's most recent own step (no-op when none). */
  undo(): void;
  /** Re-applies this tab's most recently undone own step (no-op when none). */
  redo(): void;
}

/**
 * React binding for an {@link UndoController} (story 8, undo.controls).
 *
 * Subscribes to the controller's stack-state changes so `canUndo`/`canRedo`
 * re-evaluate whenever a step is added/popped. Both states are forced to
 * `false` while `canEdit` is false (a locked board — story 4 load failure —
 * offers no undo). Only this tab's controller is touched, whose stacks hold
 * only this person's LOCAL_ORIGIN steps (personal scope).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => controller.onChange(() => force()), [controller]);

  const canUndo = canEdit && controller.canUndo();
  const canRedo = canEdit && controller.canRedo();

  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return { canUndo, canRedo, undo, redo };
}
