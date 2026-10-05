/**
 * The React binding for the per-person undo history (`undo.own`).
 *
 * Two jobs live here:
 *
 *  - {@link useUndo} turns the imperative {@link UndoController} into render state — the
 *    `canUndo` / `canRedo` that light the toolbar buttons — by subscribing to the
 *    controller's stack changes. When the board cannot be written to, both report false
 *    so the controls go idle rather than offering to change a document that is about to
 *    be thrown away (`undo.edit_lock`).
 *
 *  - {@link UndoContext} hands the same controller to components deep in the tree — the
 *    sticky note's text editor needs it to keep its own Ctrl+Z and to open and close an
 *    edit session as one step. It reaches them without widening `ObjectComponentProps`,
 *    which every object type shares and which has no business knowing about undo.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { UndoController } from './undo';

/** The controller for the board currently on screen, or nothing outside a board. */
const UndoContext = createContext<UndoController | null>(null);

export function UndoProvider(props: { controller: UndoController; children: ReactNode }): ReactNode {
  // `createElement` rather than JSX keeps this file `.ts`: it is a plain binding over the
  // controller, and the project's hook modules stay JSX-free.
  return createElement(UndoContext.Provider, { value: props.controller }, props.children);
}

/**
 * The board's undo controller. `null` away from a board — a component that needs it (the
 * text editor) treats a missing controller as "undo is not mine to run here" and leaves
 * the key to the browser.
 */
export function useUndoController(): UndoController | null {
  return useContext(UndoContext);
}

export interface UndoActions {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * The undo controls, bound to render: the two booleans track the controller's stacks and
 * the two functions act on them. Both booleans read as false while `canEdit` is false —
 * an unwritable board has no undoable change from this client to offer.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  // A single version counter as the dependency: every stack change bumps it, and the
  // booleans are read fresh at render from the controller, so there is exactly one
  // source of truth for "is there a step".
  const [version, setVersion] = useState(0);
  useEffect(() => controller.onChange(() => setVersion((n) => n + 1)), [controller]);

  const undo = useCallback(() => {
    controller.undo();
  }, [controller]);
  const redo = useCallback(() => {
    controller.redo();
  }, [controller]);

  // `version` deliberately appears only in the dependency list: it is the signal that a
  // stack changed, and the booleans are then re-read from the controller — the single
  // source of truth for whether a step exists.
  const canUndo = canEdit && controller.canUndo();
  const canRedo = canEdit && controller.canRedo();
  return useMemo(
    () => ({ canUndo, canRedo, undo, redo }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canUndo, canRedo, undo, redo, version]
  );
}
