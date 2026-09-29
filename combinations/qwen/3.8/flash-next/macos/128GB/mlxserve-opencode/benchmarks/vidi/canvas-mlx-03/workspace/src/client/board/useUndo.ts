// React binding for the tab's undo history (design `undo.controls`).
//
// `useUndo` is what the Undo/Redo buttons render from: two booleans and two
// actions. It subscribes to the controller, so a step this tab made — a drag that
// ended, a delete, a burst of typing — enables the Undo button as it happens, and
// emptying the history disables it again.
//
// The two states come from *this tab's* stacks, so on a board with five people
// each of the five sees a different pair of buttons: mine goes grey when I have
// nothing of my own to undo, whoever else is typing.
//
// The controller also has to reach the components that are deep in the object tree
// — a note's text editor and its colour toolbar — without the object registry
// (stories 9-12 add types without undo code) having to pass it down. A context
// holds it: `UndoControllerContext` is provided once by the board, and anything
// inside the board can ask for it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { UndoController } from './undo.ts';

export interface UndoActions {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** Close the current capture window: one action, one undo step. */
  boundary(): void;
}

/**
 * The board's undo/redo state. Both flags read false on a board that could not be
 * loaded: there is nothing to change there, and the buttons say so rather than
 * undoing into a document that was never read (`canEdit`, story 4).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  // A counter, not a snapshot of the stacks: the stacks themselves stay behind the
  // controller's methods and are read once per render.
  const [revision, setRevision] = useState(0);

  useEffect(
    () => controller.onChange(() => setRevision((n) => n + 1)),
    [controller],
  );

  const undo = useCallback(() => controller.undo(), [controller]);
  const redo = useCallback(() => controller.redo(), [controller]);
  const boundary = useCallback(() => controller.boundary(), [controller]);

  return useMemo(() => {
    // The stacks are read here, at render time; `revision` is the reason this runs
    // again when one of them changes.
    void revision;
    return {
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
      undo,
      redo,
      boundary,
    };
  }, [controller, canEdit, revision, undo, redo, boundary]);
}

/** The controller of the board this component tree belongs to, if there is one. */
export const UndoControllerContext = createContext<UndoController | null>(null);

/** The board's undo controller, or null outside a board (a bare component test). */
export function useUndoController(): UndoController | null {
  return useContext(UndoControllerContext);
}

/**
 * `boundary()` for a component that finishes a single action: a colour swatch, a
 * note's editing session. It is a no-op where no controller is mounted, so an
 * object component rendered on its own neither crashes nor silently merges.
 */
export function useUndoBoundary(): () => void {
  const controller = useUndoController();
  const ref = useRef(controller);
  ref.current = controller;
  return useCallback(() => ref.current?.boundary(), []);
}
