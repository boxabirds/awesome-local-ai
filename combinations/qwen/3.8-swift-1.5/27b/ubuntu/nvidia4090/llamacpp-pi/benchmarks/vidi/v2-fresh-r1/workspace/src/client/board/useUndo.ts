// React binding for the UndoController: exposes canUndo/canRedo/undo/redo
// with reactivity to stack changes, gated by canEdit.

import { useCallback, useEffect, useState } from 'react';
import type { UndoController } from './undo';

export function useUndo(controller: UndoController | null, canEdit: boolean) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!controller) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    // Initial sync.
    setCanUndo(canEdit && controller.canUndo());
    setCanRedo(canEdit && controller.canRedo());
    const unsub = controller.onChange(() => {
      setCanUndo(canEdit && controller.canUndo());
      setCanRedo(canEdit && controller.canRedo());
    });
    return unsub;
  }, [controller, canEdit]);

  const undo = useCallback(() => {
    if (controller && canEdit) controller.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (controller && canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && (controller?.canUndo() ?? false),
    canRedo: canEdit && (controller?.canRedo() ?? false),
    undo,
    redo,
  };
}
