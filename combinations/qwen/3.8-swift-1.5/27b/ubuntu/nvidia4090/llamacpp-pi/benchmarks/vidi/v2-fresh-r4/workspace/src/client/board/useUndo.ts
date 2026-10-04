import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/**
 * Create (and own) the board's per-user undo controller for the lifetime
 * of `doc`. History is session-only: it is dropped when the doc changes
 * (board switch) or on unmount (page reload creates a fresh one).
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const controller = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => controller.destroy(), [controller]);
  return controller;
}

export interface UseUndoResult {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** Close the current capture window (call at gesture/tool boundaries). */
  boundary(): void;
}

/**
 * Reactive undo state + actions for the UI.
 * `canEdit` locks undo/redo (a read-only session must not mutate the doc).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  const [canUndo, setCanUndo] = useState<boolean>(controller.canUndo());
  const [canRedo, setCanRedo] = useState<boolean>(controller.canRedo());

  useEffect(
    () =>
      controller.onChange(() => {
        setCanUndo(controller.canUndo());
        setCanRedo(controller.canRedo());
      }),
    [controller],
  );

  return {
    canUndo,
    canRedo,
    undo: () => {
      if (canEdit) controller.undo();
    },
    redo: () => {
      if (canEdit) controller.redo();
    },
    boundary: () => controller.boundary(),
  };
}
