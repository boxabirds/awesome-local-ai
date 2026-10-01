import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { createUndo } from './undo';
import type { UndoController } from './undo';

/** Lets the text editor reach this tab's controller without threading it through every object type. */
export const UndoContext = createContext<UndoController | null>(null);
export const useUndoController = (): UndoController | null => useContext(UndoContext);

/** One controller per board doc; destroyed when the doc changes or the board unmounts (history is session-only). */
export function useUndoHistory(doc: Y.Doc): UndoController {
  const [controller, setController] = useState(() => createUndo(doc));
  useEffect(() => {
    let c = controller;
    if (c.isDestroyed()) {
      c = createUndo(doc);
      setController(c);
    }
    return () => c.destroy();
  }, [doc, controller]);
  return controller;
}

export function useUndo(
  controller: UndoController,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  const canUndo = useSyncExternalStore(subscribe, () => controller.canUndo());
  const canRedo = useSyncExternalStore(subscribe, () => controller.canRedo());
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && canUndo, canRedo: canEdit && canRedo, undo, redo };
}
