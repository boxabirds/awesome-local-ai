// The React binding for the per-person undo history (story 8).
//
// `useUndoController` owns one `UndoController` per board document, for the life of
// the mounted board (undo.session_only: a reload builds a fresh, empty one).
// `useUndo` turns it into the `{ canUndo, canRedo, undo, redo }` the toolbar and
// keyboard shortcuts use, re-rendering whenever the history changes.
//
// `UndoControllerContext` passes the raw controller down to the pieces that must
// mark undo boundaries or handle undo keys while they own the keyboard - the sticky
// text editor, which stops key events from ever reaching the board's shortcuts.
//
// This file is intentionally `.ts` (no JSX): the provider in BoardPage and the
// buttons in UndoButtons are the `.tsx` files that render it.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo.js';

/** Build one controller for `doc`, destroyed when the board unmounts or changes. */
export function useUndoController(doc: Y.Doc): UndoController {
  const controller = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => controller.destroy(), [controller]);
  return controller;
}

export interface UndoActions {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * Wire the controller to React state. `canUndo`/`canRedo` are gated on `canEdit`, so
 * a viewer (or a board that failed to load) always sees both false and both buttons
 * disabled; they also re-compute on every history change.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  const [state, setState] = useState(() => ({
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
  }));

  useEffect(() => {
    const update = (): void => {
      setState({ canUndo: canEdit && controller.canUndo(), canRedo: canEdit && controller.canRedo() });
    };
    update();
    return controller.onChange(update);
  }, [controller, canEdit]);

  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undo: () => controller.undo(),
    redo: () => controller.redo(),
  };
}

/**
 * The raw controller, available to components that own the keyboard and must call
 * `boundary`/`undo`/`redo` themselves. `null` on a board with no undo history.
 */
export const UndoControllerContext = createContext<UndoController | null>(null);

/** The board's undo controller, or null outside a board. */
export function useUndoControllerContext(): UndoController | null {
  return useContext(UndoControllerContext);
}
