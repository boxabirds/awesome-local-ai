/**
 * React access to the undo controller (story 8, design "The app glue").
 *
 * `useUndoController` owns one controller per board document: it is built for
 * the live document, destroyed when the document changes or the board
 * unmounts, and — because React 19 development mode runs every mount's
 * effects setup → cleanup → setup — rebuilt in the second setup when the
 * cleanup destroyed the controller, with a forced re-render so the keyboard
 * hook and the buttons re-read it. `useUndo` turns the controller's stack
 * state into the two booleans the toolbar buttons render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardDoc } from './useBoardDoc';
import { createUndo, type UndoController } from './undo';

interface UndoHolder {
  board: BoardDoc;
  controller: UndoController;
  /** True once the controller has been destroyed and must not be used. */
  destroyed: boolean;
  /** True when this hook built the controller and may destroy it. */
  owned: boolean;
}

export function useUndoController(
  board: BoardDoc,
  provided: UndoController | undefined,
): UndoController {
  const [generation, setGeneration] = useState(0);
  const holder = useRef<UndoHolder | null>(null);

  let entry = holder.current;
  if (entry === null || entry.destroyed || entry.board !== board) {
    // First render of this board — or a Strict Mode remount whose cleanup
    // destroyed the previous controller, or the board document changed
    // without the surface remounting. Build a live controller before any
    // hook or handler reads one this render.
    entry = {
      board,
      controller: provided ?? createUndo(board.doc),
      destroyed: false,
      owned: provided === undefined,
    };
    holder.current = entry;
  }

  useEffect(() => {
    const current = holder.current;
    if (current === null || !current.owned) return;
    if (current.destroyed) {
      // The effect is running again after its own cleanup (Strict Mode
      // remount): replace the dead controller and re-render so everything
      // downstream subscribes to the live one.
      holder.current = {
        board,
        controller: createUndo(board.doc),
        destroyed: false,
        owned: true,
      };
      setGeneration((generationNow) => generationNow + 1);
      return;
    }
    return () => {
      current.destroyed = true;
      current.controller.destroy();
    };
    // `generation` re-runs this effect after the rebuild above, so the
    // replacement controller gets a cleanup of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, generation]);

  return entry.controller;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * The undo state the toolbar renders: the two empty-stack booleans (with
 * `canEdit` folded in — a board that cannot be edited cannot undo) and the
 * two actions. Re-renders whenever the controller says a stack changed, and
 * after every undo or redo of its own, so a drained history shows disabled
 * buttons without waiting for the next change.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [stacks, setStacks] = useState(() => ({
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
  }));

  useEffect(() => {
    const refresh = (): void => {
      setStacks((previous) => {
        const canUndo = canEdit && controller.canUndo();
        const canRedo = canEdit && controller.canRedo();
        if (previous.canUndo === canUndo && previous.canRedo === canRedo) {
          return previous;
        }
        return { canUndo, canRedo };
      });
    };
    refresh();
    return controller.onChange(refresh);
  }, [controller, canEdit]);

  const undo = useCallback((): void => {
    controller.undo();
  }, [controller]);

  const redo = useCallback((): void => {
    controller.redo();
  }, [controller]);

  return useMemo(
    () => ({ canUndo: stacks.canUndo, canRedo: stacks.canRedo, undo, redo }),
    [stacks, undo, redo],
  );
}