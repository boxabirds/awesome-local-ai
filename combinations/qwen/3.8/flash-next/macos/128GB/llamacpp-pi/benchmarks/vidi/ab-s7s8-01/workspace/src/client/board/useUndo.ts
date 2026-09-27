// React binding for the undo controller (story 8).
//
// Subscribes to controller stack changes so the toolbar buttons re-render when
// a step lands or is consumed, and gates everything on `canEdit` (read-only
// viewers never undo — buttons disabled, shortcuts ignored, PRD undo.safe /
// story 7 AC6).
//
// The controller parameter is nullable because the controller exists only for
// the lifetime of the board session: App creates it in an effect once the
// board doc (and provider) are up and destroys it on teardown. The one frame
// before the effect runs renders the buttons as disabled — nothing else
// observes the null state.

import { createContext, useCallback, useEffect, useReducer } from 'react';
import type { UndoController } from './undo';

/** Carries the session controller to the sticky text editor, which handles
 * Ctrl/Cmd+Z while editing (the window-level handler ignores keys originating
 * in text fields). Not a change to the object-renderer props contract — the
 * editor stays a normal ObjectProps renderer. */
export const UndoControllerContext = createContext<UndoController | null>(null);

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  /** No-op unless editable and the stack is non-empty. */
  undo(): void;
  /** No-op unless editable and the redo stack is non-empty. */
  redo(): void;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UndoApi {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!controller) return;
    return controller.onChange(bump);
  }, [controller, bump]);

  const undo = useCallback(() => {
    if (canEdit) controller?.undo();
  }, [controller, canEdit]);

  const redo = useCallback(() => {
    if (canEdit) controller?.redo();
  }, [controller, canEdit]);

  // Read during render; correctness holds because every stack mutation routes
  // through onChange -> bump (undo.ts), and canEdit flips re-render App.
  const canUndo = canEdit && controller !== null && controller.canUndo();
  const canRedo = canEdit && controller !== null && controller.canRedo();

  return { canUndo, canRedo, undo, redo };
}
