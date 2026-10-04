import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/** What the undo controls on the toolbar need to know and do. */
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * One undo history per open board document.
 *
 * The history belongs to the document this tab is looking at, and to nobody else: a different
 * board is a different history, and a document that goes away takes its history with it, because
 * undo is session-only (`undo.session_only`) and there is nowhere sensible it could be kept.
 */
export function useUndoHistory(doc: Y.Doc): UndoController {
  const ref = useRef<{ doc: Y.Doc; controller: UndoController } | null>(null);
  if (ref.current === null || ref.current.doc !== doc) {
    ref.current = { doc, controller: createUndo(doc) };
  }
  const entry = ref.current;

  useEffect(() => {
    // The cleanup runs with the controller that was current when it was set up, which is exactly
    // the one to throw away when the document changes or the board closes.
    return () => {
      entry.controller.destroy();
    };
  }, [entry]);

  return entry.controller;
}

/**
 * The undo stacks as React state.
 *
 * `canUndo` and `canRedo` are read from the manager whenever it says a stack changed, and are both
 * false while this person may not write at all: on a board that failed to load there is nothing
 * here that is known to be the board, so there is nothing worth undoing either (story 4's edit
 * lock covers undo, because undo is a write).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoState {
  const [stacks, setStacks] = useState(() => ({
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
  }));

  useEffect(() => {
    const sync = (): void => {
      const next = { canUndo: controller.canUndo(), canRedo: controller.canRedo() };
      setStacks((current) =>
        current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next,
      );
    };
    // Subscribe first, then read: a change made between the render and this effect would
    // otherwise be missed, and the buttons would sit there saying the wrong thing until the next.
    const stop = controller.onChange(sync);
    sync();
    return stop;
  }, [controller]);

  const undo = useCallback((): void => {
    if (canEdit) {
      controller.undo();
    }
  }, [controller, canEdit]);

  const redo = useCallback((): void => {
    if (canEdit) {
      controller.redo();
    }
  }, [controller, canEdit]);

  return {
    canUndo: canEdit && stacks.canUndo,
    canRedo: canEdit && stacks.canRedo,
    undo,
    redo,
  };
}
