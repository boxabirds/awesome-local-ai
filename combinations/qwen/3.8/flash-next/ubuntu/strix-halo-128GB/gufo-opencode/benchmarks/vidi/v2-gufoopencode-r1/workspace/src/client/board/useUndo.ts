import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { UndoController } from './undo';

// One controller per mounted board doc, provided by BoardShell. Components
// that perform model mutations call boundary() around them; components that
// display history state use useUndo.
export const UndoContext = createContext<UndoController | null>(null);

export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UndoState {
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (controller === null) {
      setFlags({ canUndo: false, canRedo: false });
      return;
    }
    const sync = (): void => {
      setFlags((prev) => {
        const next = { canUndo: controller.canUndo(), canRedo: controller.canRedo() };
        return prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next;
      });
    };
    sync();
    return controller.onChange(sync);
  }, [controller]);

  return useMemo<UndoState>(
    () => ({
      canUndo: canEdit && flags.canUndo,
      canRedo: canEdit && flags.canRedo,
      undo: () => {
        if (canEdit) controller?.undo();
      },
      redo: () => {
        if (canEdit) controller?.redo();
      }
    }),
    [canEdit, flags, controller]
  );
}
