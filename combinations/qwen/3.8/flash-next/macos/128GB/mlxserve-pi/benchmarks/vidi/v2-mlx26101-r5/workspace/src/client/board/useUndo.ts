/**
 * The undo history, as React state (story 8).
 *
 * The controller keeps its stacks in Yjs, outside React; this hook is the only place that turns
 * "a step was added or taken" into a re-render, so that the toolbar buttons are never lying about
 * what can be undone. Everything the board does with the history goes through here rather than
 * calling the controller directly, for one reason: a board that cannot be written to has to refuse
 * undo in the same place for all three of its doors — the buttons, the keyboard and the editor.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import type { UndoController } from './undo';

/** What the undo buttons and the keyboard shortcuts need to know and to be able to ask for. */
export interface UndoActions {
  /** There is a step of this person's to take back, and this board may be written to. */
  canUndo: boolean;
  /** There is an undone step of this person's to put back, and this board may be written to. */
  canRedo: boolean;
  /** Take the newest of my steps back. Does nothing when there is no step or no board to write to. */
  undo(): void;
  /** Put back what `undo` last took. Does nothing when there is nothing or no board to write to. */
  redo(): void;
}

/**
 * `UndoActions` plus the one call a write site owes the history: `boundary`, which says that the
 * action being written is over. It is not in `UndoActions` because nothing a person clicks asks for
 * it — the drag, the delete and the burst of typing do, and they are the ones that carry it.
 */
export type UndoControls = UndoActions & Pick<UndoController, 'boundary'>;

/**
 * Subscribes to the controller and answers whether undo and redo are possible *here, now*.
 *
 * `canEdit` is story 4's answer — the room could not load this board, so nothing may be written to
 * it. Undoing is writing, so an unloadable board has no undo: the buttons come back disabled and the
 * shortcuts are refused before they reach the history, which is also what keeps a person from
 * undoing changes they made before the board went unreadable.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.onChange(onStoreChange),
    [controller],
  );
  // Two stores rather than one object: `useSyncExternalStore` compares snapshots with `Object.is`,
  // and a fresh `{canUndo, canRedo}` object every time would re-render on every notification,
  // including the ones that changed nothing. Booleans are their own stable identity.
  const stepsToUndo = useSyncExternalStore(subscribe, () => controller.canUndo(), () => controller.canUndo());
  const stepsToRedo = useSyncExternalStore(subscribe, () => controller.canRedo(), () => controller.canRedo());

  // Refused at the door rather than at the caller: the buttons, the shortcuts and the note editor all
  // arrive here, so a board that has stopped being writable stops being writable for undo in one place
  // — including for a click that was already on its way when the room said it could not read the board.
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const undo = useCallback(() => {
    if (!canEditRef.current) return;
    controller.undo();
  }, [controller]);
  const redo = useCallback(() => {
    if (!canEditRef.current) return;
    controller.redo();
  }, [controller]);

  return useMemo(
    () => ({ canUndo: stepsToUndo && canEdit, canRedo: stepsToRedo && canEdit, undo, redo }),
    [stepsToUndo, stepsToRedo, canEdit, undo, redo],
  );
}
