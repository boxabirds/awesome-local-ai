import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { NO_UNDO, type UndoController } from './undo';

/**
 * The board's undo controller, for components deep in the tree (the sticky
 * text editor) that mark step boundaries and undo typing themselves.
 */
export const UndoContext = createContext<UndoController>(NO_UNDO);

export function useUndoController(): UndoController {
  return useContext(UndoContext);
}

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/** React binding for undo.controls: stack state re-renders on every change. */
export function useUndo(controller: UndoController, canEdit: boolean): UndoApi {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  const canUndo = useSyncExternalStore(subscribe, controller.canUndo, controller.canUndo);
  const canRedo = useSyncExternalStore(subscribe, controller.canRedo, controller.canRedo);
  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.boundary();
    controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.boundary();
    controller.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && canUndo, canRedo: canEdit && canRedo, undo, redo };
}
