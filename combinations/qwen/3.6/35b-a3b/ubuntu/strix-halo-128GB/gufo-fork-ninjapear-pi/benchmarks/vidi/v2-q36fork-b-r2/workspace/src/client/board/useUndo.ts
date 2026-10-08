import * as React from 'react';
import type { UndoController } from './undo';

export function useUndo(
  controller: UndoController | null,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  React.useEffect(() => {
    if (!controller) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    // Subscribe to changes (stack-item-added / stack-item-popped emit via onChange)
    const unsub = controller.onChange(() => {
      setCanUndo(controller.canUndo() && canEdit);
      setCanRedo(controller.canRedo() && canEdit);
    });
    // Initial state
    setCanUndo(controller.canUndo() && canEdit);
    setCanRedo(controller.canRedo() && canEdit);
    return unsub;
  }, [controller, canEdit]);

  const undo = React.useCallback(() => {
    controller?.undo();
  }, [controller]);

  const redo = React.useCallback(() => {
    controller?.redo();
  }, [controller]);

  return { canUndo, canRedo, undo, redo };
}
