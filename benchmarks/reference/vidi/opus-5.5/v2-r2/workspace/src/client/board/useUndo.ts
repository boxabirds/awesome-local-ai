import { type KeyboardEvent as ReactKeyboardEvent, createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

/** Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z or Ctrl+Y → redo; anything else → null. */
export function undoShortcut(e: KeyboardEvent | ReactKeyboardEvent): 'undo' | 'redo' | null {
  if (e.altKey) return null;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'y') return 'redo';
  return null;
}

/** A controller with no history (before the board's controller exists). */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => {},
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => {},
  onChange: () => () => {},
  checkpoint: () => null,
  canUndoSince: () => false,
  holdCapture: () => {},
  destroy: () => {},
};

/** The board's UndoController, for components deep in the tree (text editors). */
export const UndoContext = createContext<UndoController>(NO_UNDO);

export function useUndoController(): UndoController {
  return useContext(UndoContext);
}

/**
 * React binding for the undo controls (undo.controls): button state follows the
 * controller's stacks and is always off while the board cannot be edited.
 */
export function useUndo(
  controller: UndoController,
  canEdit: boolean,
): { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const state = useSyncExternalStore(
    useCallback((cb: () => void) => controller.onChange(cb), [controller]),
    () => (controller.canUndo() ? 1 : 0) + (controller.canRedo() ? 2 : 0),
  );
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return { canUndo: canEdit && (state & 1) !== 0, canRedo: canEdit && (state & 2) !== 0, undo, redo };
}
