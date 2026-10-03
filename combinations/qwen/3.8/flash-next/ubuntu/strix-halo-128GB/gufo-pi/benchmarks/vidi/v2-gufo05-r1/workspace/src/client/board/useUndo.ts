/**
 * The React binding for one person's undo history.
 *
 * `useUndoController` owns the controller: exactly one per board document, torn down
 * when the document changes or the board is left. That lifetime *is* the requirement
 * `undo.session_only` — nothing of the history is written anywhere, so a reload, or a
 * second tab on the same board, starts with empty stacks.
 *
 * `useUndo` is what the buttons and the shortcuts read: whether there is anything to
 * undo or redo, and the two commands. Both are refused when the board cannot be
 * written (`undo.not_editable`): on a board that failed to load there is nothing of
 * mine to undo, and undoing would write to a document that is about to be thrown away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { createUndo, type UndoController } from './undo';

export interface UndoHandle {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/** One undo controller per document, destroyed when this board is left. */
export function useUndoController(doc: Y.Doc): UndoController {
  // A ref rather than state: the controller must exist before the first render that
  // uses it, and it must not be rebuilt when anything else re-renders.
  const holder = useRef<{ doc: Y.Doc; controller: UndoController } | null>(null);
  if (holder.current === null || holder.current.doc !== doc) {
    // Changing board means changing document, and a history does not travel between
    // boards: the one for the board I left is destroyed, not carried over.
    holder.current?.controller.destroy();
    holder.current = { doc, controller: createUndo(doc) };
  }

  useEffect(() => {
    const current = holder.current;
    return () => {
      current?.controller.destroy();
      if (holder.current === current) holder.current = null;
    };
  }, [doc]);

  return holder.current.controller;
}

export function useUndo(controller: UndoController, canEdit: boolean): UndoHandle {
  const read = useCallback(
    () => ({
      // A board that cannot be edited offers no history, whatever is in the stacks:
      // the buttons say "nothing to undo" rather than "undo, but it will not work".
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
    }),
    [canEdit, controller],
  );

  const [state, setState] = useState(read);

  useEffect(() => {
    // The stacks can move between renders (a change captured, a step undone), so the
    // state is read once here and then kept up to date by the controller itself.
    setState(read());
    return controller.onChange(() => {
      setState(read());
    });
  }, [read]);

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.undo();
  }, [canEdit, controller]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.redo();
  }, [canEdit, controller]);

  return { canUndo: state.canUndo, canRedo: state.canRedo, undo, redo };
}
