// The React side of one person's undo history (story 8, undo.controls).
//
// The board owns the `UndoController` (undo.ts); this is the only thing the rest
// of the UI talks to. It answers two questions — is there something of *mine* to
// undo, and something to redo — and it answers them for as long as the controller
// lives, because every change of either stack is heard through `onChange`.
//
// `canEdit` is folded in rather than checked by every caller: a board that could
// not be loaded has no history on offer even though this tab's own steps are
// still sitting in it (story 4's edit lock), and the two buttons are disabled
// along with every other way of writing to that board. Undoing is itself a write,
// so the same lock stops the actions as stops the buttons.
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

export interface UndoActions {
  /** Something of mine can be undone, and this board can be written to. */
  canUndo: boolean;
  /** Something I undid can be put back, and this board can be written to. */
  canRedo: boolean;
  /** Undo my most recent change. Does nothing when there is nothing to undo. */
  undo(): void;
  /** Put back what an undo press took away. Does nothing when there is nothing. */
  redo(): void;
}

/** A controller, and whether the mount that made it still holds it. */
interface Holder {
  controller: UndoController;
  alive: boolean;
}

/**
 * Own the undo history of one board document for as long as this component is
 * mounted: one controller per document, thrown away when the board is closed or
 * its document is exchanged (undo.session_only — a reload starts empty).
 *
 * The controller is made during the first render, so the very first paint already
 * knows whether there is anything to undo. React's development StrictMode mounts,
 * unmounts and mounts a tree again; that second mount makes its own history, in
 * the same way a reload does, and says so in a render before anyone can press a
 * button. In a production build the first controller is the only one there ever
 * is, and it is destroyed exactly once.
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const [holder] = useState<Holder>(() => ({ controller: createUndo(doc), alive: true }));
  const [, settled] = useState(0);

  useEffect(() => {
    if (!holder.alive) {
      // Remounted after the last mount's cleanup destroyed what it held.
      holder.controller = createUndo(doc);
      holder.alive = true;
      settled((n) => n + 1);
    }
    return () => {
      holder.alive = false;
      holder.controller.destroy();
    };
  }, [doc, holder]);

  return holder.controller;
}

/**
 * Follow one board's undo history, as the buttons and shortcuts need it.
 *
 * The returned `canUndo`/`canRedo` are what to show; the returned `undo`/`redo`
 * are safe to wire straight to a click handler, since they refuse to write to a
 * board that cannot be edited.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  // The lock is read when a button is pressed, not when it was rendered: a
  // render that still shows an enabled button must not be able to write.
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const [stacks, setStacks] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
  }));

  // Every step taken, undone and put back, including the ones taken by a
  // gesture or a keystroke that never came near these buttons.
  useEffect(
    () =>
      controller.onChange(() => {
        setStacks({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
      }),
    [controller],
  );

  // The lock itself changes what the buttons may say, and no stack event
  // accompanies it: read the stacks again when it changes.
  useEffect(() => {
    setStacks({ canUndo: controller.canUndo(), canRedo: controller.canRedo() });
  }, [controller, canEdit]);

  const undo = useCallback(() => {
    if (!canEditRef.current) return;
    controller.undo();
  }, [controller]);

  const redo = useCallback(() => {
    if (!canEditRef.current) return;
    controller.redo();
  }, [controller]);

  return {
    canUndo: canEdit && stacks.canUndo,
    canRedo: canEdit && stacks.canRedo,
    undo,
    redo,
  };
}
