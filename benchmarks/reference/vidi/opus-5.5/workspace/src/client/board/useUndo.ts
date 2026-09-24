import { createContext, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/** Builds a board's controller; component tests pass a fake. */
export type UndoFactory = (doc: Y.Doc) => UndoController;

export interface UndoControls {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/** A controller with no history, used until the board's own one exists (and after unmount). */
const INERT: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => undefined,
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => undefined,
  onChange: () => () => undefined,
  destroy: () => undefined,
  beginGesture: () => undefined,
  endGesture: () => undefined,
  lastStep: () => null,
  joinLastStep: (action) => action(),
};

/**
 * The text editor inside a sticky reaches this tab's controller through context (object
 * components get the registry's generic props only). Null outside a board.
 */
export const UndoContext = createContext<UndoController | null>(null);

/**
 * One controller per board document, created on mount and destroyed on unmount or board change
 * (history is session-only, undo.session_only). Created in an effect so React's StrictMode
 * mount/unmount/mount leaves exactly one live controller.
 */
export function useUndoController(doc: Y.Doc, factory: UndoFactory = createUndo): UndoController {
  const [controller, setController] = useState<UndoController>(INERT);
  // The factory is read when the document changes, not tracked: an inline factory must not
  // recreate (and so empty) the history on every render.
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  useEffect(() => {
    const created = factoryRef.current(doc);
    setController(() => created);
    return () => {
      created.destroy();
      setController(() => INERT);
    };
  }, [doc]);
  return controller;
}

const CAN_UNDO = 1;
const CAN_REDO = 2;

/**
 * Button and shortcut state for this tab's controller (undo.controls). Both are unavailable
 * while the board cannot be edited (story 4 load failure, undo.not_editable).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoControls {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  const getState = useCallback(
    () => (controller.canUndo() ? CAN_UNDO : 0) | (controller.canRedo() ? CAN_REDO : 0),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, getState, getState);
  const canUndo = canEdit && (state & CAN_UNDO) !== 0;
  const canRedo = canEdit && (state & CAN_REDO) !== 0;
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return useMemo(() => ({ canUndo, canRedo, undo, redo }), [canUndo, canRedo, undo, redo]);
}
