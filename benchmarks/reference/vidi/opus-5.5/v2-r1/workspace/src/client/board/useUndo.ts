import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

/** This tab's undo controller for the open board (null while there is none, e.g. in isolated tests). */
export const UndoContext = createContext<UndoController | null>(null);

export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}

const noSubscription = () => () => {};

/**
 * React binding of an UndoController: undo and redo are unavailable while the board cannot be
 * edited (story 4 load failure).
 */
export function useUndo(
  controller: UndoController | null,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const subscribe = controller ? controller.onChange : noSubscription;
  const canUndo = useSyncExternalStore(subscribe, () => controller?.canUndo() ?? false);
  const canRedo = useSyncExternalStore(subscribe, () => controller?.canRedo() ?? false);
  const undo = useCallback(() => {
    if (canEdit) controller?.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller?.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && canUndo, canRedo: canEdit && canRedo, undo, redo };
}
