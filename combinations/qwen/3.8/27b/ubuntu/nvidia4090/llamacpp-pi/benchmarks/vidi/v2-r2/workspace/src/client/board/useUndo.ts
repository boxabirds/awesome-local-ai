/**
 * React binding for an UndoController (story 8, undo.controls).
 *
 * Subscribes to the controller's onChange (stack-item-added / popped /
 * cleared) so canUndo/canRedo are always current, and gates everything on
 * `canEdit` (persist.client_status): a load-failed board can never undo or
 * redo, and its buttons render disabled.
 *
 * The hook only ever talks to THIS tab's controller, whose stacks hold only
 * this person's LOCAL_ORIGIN steps — personal scope (undo.own, undo.redo).
 */
import { useCallback, useEffect, useReducer } from 'react';
import type { UndoController } from './undo';

export interface UndoActions {
  /** True when a local step can be undone and the board is editable. */
  canUndo: boolean;
  /** True when an undone local step can be reapplied and the board is editable. */
  canRedo: boolean;
  /** Undo the last local step (no-op when the stack is empty or not editable). */
  undo(): void;
  /** Re-apply the last undone local step (no-op when the stack is empty or not editable). */
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  // Force a re-render on every stack change; canUndo/canRedo are read live
  // below, so the render always reflects the current stacks.
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => controller.onChange(force), [controller]);

  const undo = useCallback((): void => {
    if (canEdit) {
      controller.undo();
    }
  }, [controller, canEdit]);

  const redo = useCallback((): void => {
    if (canEdit) {
      controller.redo();
    }
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}
