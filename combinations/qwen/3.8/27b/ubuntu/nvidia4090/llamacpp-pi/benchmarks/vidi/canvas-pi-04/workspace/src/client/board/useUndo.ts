// Story 8: React binding for the UndoController (anchors: undo.buttons,
// undo.shortcuts, undo.not_editable).
//
// useUndo subscribes to the controller's stack events so the toolbar buttons
// re-render with fresh canUndo/canRedo state, and folds in the story 4 edit
// lock: when the board cannot be loaded (load_failed) the actions are no-ops
// and the buttons stay disabled.
//
// UndoControllerContext carries the per-board controller to components
// rendered outside App's prop chain (registry object components: the sticky
// text editor needs boundary()/undo() but ObjectProps stays minimal).

import { useCallback, useContext, useEffect, useState } from 'react';
import { createContext } from 'react';
import type { UndoController } from './undo';

/** The per-board undo controller (null until the controller exists). */
export const UndoControllerContext = createContext<UndoController | null>(null);

/** Convenience hook for consuming the controller. */
export function useUndoController(): UndoController | null {
  return useContext(UndoControllerContext);
}

export interface UndoBinding {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UndoBinding {
  const [stack, setStack] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (controller === null) {
      setStack({ canUndo: false, canRedo: false });
      return;
    }
    setStack({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    return controller.onChange(() => {
      setStack({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
    });
  }, [controller]);

  const undo = useCallback((): void => {
    if (controller !== null && canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback((): void => {
    if (controller !== null && canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && stack.canUndo,
    canRedo: canEdit && stack.canRedo,
    undo,
    redo,
  };
}
