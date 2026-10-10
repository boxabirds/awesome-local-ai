import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/**
 * The React side of story 8.
 *
 * `useUndoController` gives one board one history, `useUndo` turns that history
 * into what the toolbar and the keyboard need - two booleans and two actions -
 * and `UndoControllerContext` hands the same controller to the object editors,
 * which sit far below the board in the tree (`registry.tsx` renders them from a
 * plain props object, so a prop would mean changing every object kind's props
 * for a story about undo).
 */

export const UndoControllerContext = createContext<UndoController | null>(null);

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * The history for this board.
 *
 * `provided` is what a test passes to drive the board's own history; a board
 * built by the app gets a history of its own. A history this hook did not make
 * is never destroyed here - it belongs to whoever made it.
 */
export function useUndoController(doc: Y.Doc, provided: UndoController | undefined): UndoController {
  const controller = useMemo(() => provided ?? createUndo(doc), [doc, provided]);
  // The board we left loses its history; the one we are on keeps its own. The
  // hook never destroys the live controller: an unmount takes the document with
  // it, and `Y.UndoManager` already unsubscribes itself on `doc.destroy()`.
  const previous = useRef(controller);
  useEffect(() => {
    if (previous.current !== controller) {
      previous.current.destroy();
      previous.current = controller;
    }
    return undefined;
  }, [controller]);
  return controller;
}

/**
 * Undo and redo as a screen sees them.
 *
 * The booleans come from the stacks; the actions refuse a board nobody was
 * given (`undo.controls`: "shortcuts and toolbar buttons are unavailable when
 * the board is not editable") and every stack change re-renders, so a button
 * is disabled the moment there is nothing left to undo.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [, stamp] = useReducer((count: number) => count + 1, 0);
  useEffect(() => controller.onChange(stamp), [controller]);

  const undo = useCallback(() => {
    if (!canEdit) {
      return;
    }
    controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (!canEdit) {
      return;
    }
    controller.redo();
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo,
    redo,
  };
}

/** The history of the board this component is inside (`null` outside a board). */
export function useBoardUndo(): UndoController | null {
  return useContext(UndoControllerContext);
}
