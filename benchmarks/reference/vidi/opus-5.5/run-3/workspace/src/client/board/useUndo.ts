import { createContext, useCallback, useEffect, useState } from 'react';
import { NO_UNDO, type UndoController } from './undo';

/** This tab's undo controller for the board, for components deep in the tree (text editor, note toolbar). */
export const UndoContext = createContext<UndoController>(NO_UNDO);

/** Runs one model change as its own undo step (never merged with a neighbouring change). */
export function asStep<T>(controller: UndoController, change: () => T): T {
  controller.boundary();
  try {
    return change();
  } finally {
    controller.boundary();
  }
}

/**
 * React binding for the undo controls (undo.controls): button state follows the controller's stacks and is
 * off while the board cannot be edited; undo and redo do nothing then.
 */
export function useUndo(
  controller: UndoController,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const read = useCallback(() => ({ canUndo: controller.canUndo(), canRedo: controller.canRedo() }), [controller]);
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () =>
      setState((s) => {
        const next = read();
        return s.canUndo === next.canUndo && s.canRedo === next.canRedo ? s : next;
      });
    update();
    return controller.onChange(update);
  }, [controller, read]);
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && state.canUndo, canRedo: canEdit && state.canRedo, undo, redo };
}
