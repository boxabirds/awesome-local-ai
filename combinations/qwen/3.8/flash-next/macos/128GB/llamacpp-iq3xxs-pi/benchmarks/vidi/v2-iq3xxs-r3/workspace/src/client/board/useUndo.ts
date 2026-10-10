/**
 * The React side of the undo history (`undo.controls`).
 *
 * Two things live here: owning one controller per board document, and the pair
 * of numbers the interface shows — whether Undo and Redo have anything to do.
 * They are read from the controller rather than counted here, because the
 * controller is the only thing that knows what a step is.
 */

import { useEffect, useMemo, useState } from 'react';
import type * as Y from 'yjs';

import { createUndo } from './undo';
import type { UndoController } from './undo';

/**
 * The board's undo history, owned for as long as this board document is open.
 *
 * One controller per document (`undo.session_only`): it is created with the
 * document, and destroyed when the document is replaced or the board is left,
 * which is also why reloading a board leaves nothing to undo. Component tests
 * pass their own controller in, so they can count the steps the board makes.
 */
export function useUndoController(doc: Y.Doc, injected?: UndoController): UndoController {
  const owned = useMemo(() => (injected === undefined ? createUndo(doc) : null), [doc, injected]);
  useEffect(
    () => () => {
      owned?.destroy();
    },
    [owned],
  );
  return injected ?? owned ?? NO_HISTORY;
}

/**
 * A history that remembers nothing, for the branch where a board has neither a
 * controller of its own nor one brought by a test. It cannot be reached while a
 * document is here; should it ever be, a board nobody can undo is the safe thing
 * to fall back to.
 */
const NO_HISTORY: UndoController = {
  undo: () => false,
  redo: () => false,
  boundary: () => {},
  canUndo: () => false,
  canRedo: () => false,
  addScope: () => {},
  onChange: () => () => {},
  destroy: () => {},
};

/** What every control that undoes something is handed. */
export interface UndoActions {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Undo one own step; does nothing when there is none, or the board is read-only. */
  undo(): void;
  /** Redo the last step this person undid; same refusals. */
  redo(): void;
}

/**
 * Undo and redo as this screen shows them: never offered on a board this client
 * may not write to (story 4's edit lock, TC-20), and re-read whenever the
 * controller's stacks change — a local step, an undo, a redo, or a new step
 * clearing the redo stack (`undo.redo_cleared`).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoActions {
  // The stacks live in the controller, outside React; this is the ping that
  // pulls their state back into a render.
  const [revision, setRevision] = useState(0);
  useEffect(() => controller.onChange(() => setRevision((step) => step + 1)), [controller]);

  return useMemo(
    () => ({
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
      undo: () => {
        if (!canEdit) return;
        controller.undo();
        setRevision((step) => step + 1);
      },
      redo: () => {
        if (!canEdit) return;
        controller.redo();
        setRevision((step) => step + 1);
      },
    }),
    [controller, canEdit, revision],
  );
}
