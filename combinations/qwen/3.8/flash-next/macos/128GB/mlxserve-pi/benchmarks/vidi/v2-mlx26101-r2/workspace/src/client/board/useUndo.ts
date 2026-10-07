import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import type * as Y from 'yjs';

import type { UndoController } from './undo.js';
import { createUndo } from './undo.js';

/** What the board (and the two buttons) get from this hook. */
export interface UseUndoResult {
  /** Something of this person's to undo, and the board takes edits. */
  canUndo: boolean;
  /** Something of this person's to redo, and the board takes edits. */
  canRedo: boolean;
  /** Undo one of this person's own steps; does nothing when locked or empty. */
  undo(): void;
  /** Redo one of this person's own steps; does nothing when locked or empty. */
  redo(): void;
}

/**
 * The controllers ever created, so a remount can tell "the history this board was
 * built with, which its last mount threw away" from a live one. A `WeakSet`
 * because it must not be what keeps a board's history alive.
 */
const destroyed = new WeakSet<UndoController>();

/**
 * One undo history per board document, for as long as this board is mounted.
 *
 * The history belongs to the *document*, which `useBoardDoc` creates once per
 * board visit and never reuses: a page reload obviously starts over, and so does
 * walking from one board link to another, because that is a different document
 * (PRD `undo.session_only` - nothing is stored, and nothing travels to another
 * device).
 *
 * The teardown is a little more than `destroy()` in a cleanup, because React's
 * StrictMode mounts, unmounts and mounts the same tree again in development. A
 * plain cleanup would destroy the one controller this document was made with and
 * leave the still-mounted board holding a history that no longer exists - so the
 * cleanup destroys it, and the mount that follows notices and builds a fresh one.
 * That new controller has an empty history, which is the honest answer for a
 * board that was remounted.
 */
export function useUndoController(doc: Y.Doc): UndoController {
  const [controller, setController] = useState<UndoController>(() => createUndo(doc));

  useEffect(() => {
    if (destroyed.has(controller)) {
      setController(createUndo(doc));
      return;
    }
    return () => {
      controller.destroy();
      destroyed.add(controller);
    };
  }, [controller, doc]);

  return controller;
}

/**
 * The React binding of `UndoController` (`src/client/board/useUndo.ts`).
 *
 * It turns two stack lengths into the state of two buttons, and nothing else:
 * the history itself is not React state, because the board's content is not React
 * state either - both live in the document, and an undo is a change like any
 * other. `canEdit` is folded in rather than checked by every caller: a board the
 * room could not load has nothing to undo *and nothing to redo*, whatever its
 * stacks hold (PRD `undo.not_editable`).
 */
export function useUndo(controller: UndoController, canEdit: boolean): UseUndoResult {
  // The stacks are outside React, so the only thing mirrored in is "something
  // happened to them", which is exactly what `onChange` reports.
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => controller.onChange(bump), [controller, bump]);

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller.undo();
  }, [canEdit, controller]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller.redo();
  }, [canEdit, controller]);

  return useMemo<UseUndoResult>(
    () => ({
      canUndo: canEdit && controller.canUndo(),
      canRedo: canEdit && controller.canRedo(),
      undo,
      redo,
    }),
    // `version` is what says "ask the controller again"; it changes on every
    // stack event.
    [canEdit, controller, undo, redo, version],
  );
}
