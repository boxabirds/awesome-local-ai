import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/**
 * React binding for this tab's undo history: one controller per board document,
 * and a hook that tells the toolbar whether there is anything to undo or redo.
 */

/**
 * One history per board document, for exactly as long as this tab shows that board.
 *
 * Leaving the board (or reloading) destroys it: undo never reaches back past the
 * current session, and nothing about it is stored (PRD undo.session_only).
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const controller = useMemo(() => createUndo(doc), [doc]);
  useEffect(
    () => () => {
      controller.destroy();
    },
    [controller],
  );
  return controller;
}

export interface UndoControls {
  /** False when there is no step of my own to reverse, or the board cannot be edited. */
  canUndo: boolean;
  canRedo: boolean;
  /** Step back over my most recent change. */
  undo(): void;
  /** Step forward again. */
  redo(): void;
}

/**
 * Button state for the toolbar, kept live by the controller's `onChange`.
 *
 * A board that cannot be edited (it failed to load) reports both stacks as empty:
 * undoing on a board whose content is not on screen is not offered (PRD
 * undo.not_editable).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoControls {
  const [, setVersion] = useState(0);

  useEffect(
    () =>
      controller.onChange(() => {
        // A stack changed: re-read canUndo/canRedo on the next render.
        setVersion((v) => v + 1);
      }),
    [controller],
  );

  const undo = useCallback((): void => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback((): void => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}
