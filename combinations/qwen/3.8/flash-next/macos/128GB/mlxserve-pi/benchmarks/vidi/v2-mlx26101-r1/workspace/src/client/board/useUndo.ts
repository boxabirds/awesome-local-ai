// The undo controller as a React value (story 8). `App.tsx` creates one controller
// per board doc and provides it here; every undo control, the keyboard handler and
// the sticky text editor read it from context rather than threading it through
// props (the editor lives deep in the object tree, behind the type registry).
//
// The context defaults to null so a component can render without a provider (the
// Toolbar in isolation, or a board whose load failed and never built a controller):
// the controls then read as "nothing to undo / redo" and are disabled, never crash.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, createUndoFacade, type UndoController, type UndoFacade } from './undo';

export const UndoControllerContext = createContext<UndoController | null>(null);

/** The board's undo controller, or null when there is no provider. */
export function useUndoController(): UndoController | null {
  return useContext(UndoControllerContext);
}

/**
 * Own the board's undo controller for the lifetime of this component. Returns a
 * stable facade (safe as a context value / effect dependency) whose real
 * `Y.UndoManager` is created on mount and destroyed on unmount — so it survives
 * `React.StrictMode`'s extra mount / unmount (the facade re-creates an empty
 * manager) and starts empty on every (re)mount (undo.session_only).
 */
export function useBoardUndoController(doc: Y.Doc): UndoFacade {
  const facade = useMemo<UndoFacade>(() => createUndoFacade(), []);
  useEffect(() => {
    facade.attach(createUndo(doc));
    return () => facade.detach();
  }, [facade, doc]);
  return facade;
}

/** The state and actions an undo button (or the keyboard) needs. */
export interface UndoActions {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * Subscribe a component to the controller's undo/redo availability.
 *
 * `canUndo` / `canRedo` are false when the board cannot be edited at all — a
 * read-only or not-yet-loaded board never offers undo even if this tab happens to
 * have a history (undo.buttons, undo.readonly). They re-read on every stack change
 * because the `onChange` subscription bumps `version`, which re-renders and re-runs
 * these live reads of the (mutable) controller.
 */
export function useUndo(
  controller: UndoController | null,
  canEdit: boolean,
): UndoActions {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!controller) return;
    return controller.onChange(() => setVersion((v) => v + 1));
  }, [controller]);

  // `version` is referenced so the linter knows these reads are re-run on each
  // stack change; canUndo()/canRedo() are live reads of a mutable controller.
  void version;
  return {
    canUndo: canEdit && !!controller && controller.canUndo(),
    canRedo: canEdit && !!controller && controller.canRedo(),
    undo: () => {
      if (canEdit && controller) controller.undo();
    },
    redo: () => {
      if (canEdit && controller) controller.redo();
    },
  };
}
