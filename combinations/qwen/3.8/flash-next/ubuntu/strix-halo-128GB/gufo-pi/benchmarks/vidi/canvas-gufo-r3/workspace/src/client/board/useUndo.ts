import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UseUndoResult {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!controller) return () => {};
      return controller.onChange(onStoreChange);
    },
    [controller],
  );

  const getVersion = useCallback(() => {
    if (!controller) return 0;
    // Use a combined version that changes whenever either stack changes
    return (controller.canUndo() ? 1 : 0) + (controller.canRedo() ? 2 : 0);
  }, [controller]);

  const version = useSyncExternalStore(subscribe, getVersion, getVersion);

  void version; // used only to trigger re-renders

  return {
    canUndo: controller != null && canEdit && controller.canUndo(),
    canRedo: controller != null && canEdit && controller.canRedo(),
    undo: useCallback(() => {
      controller?.undo();
    }, [controller]),
    redo: useCallback(() => {
      controller?.redo();
    }, [controller]),
  };
}
