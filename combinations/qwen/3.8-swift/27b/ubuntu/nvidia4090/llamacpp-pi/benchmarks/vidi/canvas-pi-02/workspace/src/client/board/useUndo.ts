// React binding for the per-client UndoController (story 8, undo.controls):
// exposes canUndo/canRedo (false while the board is locked, undo.not_editable)
// and undo/redo actions, re-rendering on every stack change via onChange.

import { useCallback, useEffect, useReducer } from 'react';
import type { UndoController } from './undo';

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoApi {
  const [, force] = useReducer((n: number) => n + 1, 0);

  // Re-render on every stack change (added/popped) so the buttons track the
  // availability of undo/redo (undo.buttons).
  useEffect(() => controller.onChange(force), [controller]);

  const canUndo = canEdit && controller.canUndo();
  const canRedo = canEdit && controller.canRedo();

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);
  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  return { canUndo, canRedo, undo, redo };
}
