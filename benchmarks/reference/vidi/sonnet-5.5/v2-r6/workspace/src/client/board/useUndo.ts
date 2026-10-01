import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/** The board's controller, for components deep in the tree (the text editor). Null outside a board. */
export const UndoContext = createContext<UndoController | null>(null);
export const useUndoController = (): UndoController | null => useContext(UndoContext);

/** One controller per board doc; destroyed (history discarded) when the doc changes or on unmount. */
export function useCreateUndo(doc: Y.Doc): UndoController | null {
  const [controller, setController] = useState<UndoController | null>(null);
  useEffect(() => {
    const c = createUndo(doc);
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [doc]);
  return controller;
}

export function useUndo(
  controller: UndoController | null, canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const subscribe = useCallback(
    (cb: () => void) => (controller ? controller.onChange(cb) : () => {}),
    [controller],
  );
  const canUndo = useSyncExternalStore(subscribe, () => controller?.canUndo() ?? false);
  const canRedo = useSyncExternalStore(subscribe, () => controller?.canRedo() ?? false);
  return {
    canUndo: canEdit && canUndo,
    canRedo: canEdit && canRedo,
    undo: () => { if (canEdit) controller?.undo(); },
    redo: () => { if (canEdit) controller?.redo(); },
  };
}
