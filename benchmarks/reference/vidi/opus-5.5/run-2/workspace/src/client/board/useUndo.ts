/**
 * React binding of the per-person undo history (anchor: undo.controls). `App` owns one
 * controller per board doc (`useUndoController`) and shares it with the text editor through
 * `UndoContext`; `useUndo` exposes the button/shortcut state, which is off while the board
 * cannot be edited (story 4 load failure).
 */
import { createContext, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/** Stand-in used before the controller exists (first render) and in tests without one. */
export const NO_UNDO: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => undefined,
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => undefined,
  onChange: () => () => undefined,
  destroy: () => undefined,
  startGroup: () => undefined,
  undoIn: () => false,
  redoIn: () => false,
  undoSize: () => 0,
};

export const UndoContext = createContext<UndoController>(NO_UNDO);

/**
 * One controller for `doc`, created after mount and destroyed on unmount or board change,
 * so history is session-only (undo.session_only) and survives StrictMode's double effects.
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const [controller, setController] = useState<UndoController>(NO_UNDO);
  useEffect(() => {
    const c = createUndo(doc);
    setController(c);
    return () => {
      c.destroy();
      setController(NO_UNDO);
    };
  }, [doc]);
  return controller;
}

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoApi {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  // Encoded as one primitive so useSyncExternalStore sees a stable snapshot.
  const state = useSyncExternalStore(
    subscribe,
    () => (controller.canUndo() ? 1 : 0) + (controller.canRedo() ? 2 : 0),
  );
  const undo = useCallback(() => {
    if (canEdit) controller.undo();
  }, [controller, canEdit]);
  const redo = useCallback(() => {
    if (canEdit) controller.redo();
  }, [controller, canEdit]);
  return {
    canUndo: canEdit && (state & 1) !== 0,
    canRedo: canEdit && (state & 2) !== 0,
    undo,
    redo,
  };
}
