/**
 * Story 8 · tasks 1–2 — the React binding for the personal undo history.
 *
 * Owns one {@link UndoController} per board document and keeps it aligned with
 * the doc across a reload or board change, then re-renders the shell whenever the
 * history changes so the toolbar buttons and keyboard both see the current
 * `canUndo` / `canRedo`. The controller's `onChange` fires on every
 * `stack-item-added` / `stack-item-popped`; a bump counter is enough because the
 * booleans are read straight from the controller during render.
 *
 * Session-only (PRD undo.session_only): the controller is destroyed when the doc
 * changes or the shell unmounts, so a fresh board — or a successful reload after
 * a failed load — starts with an empty history and no key press from the previous
 * board can undo into the new one.
 */
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController, type UndoOptions } from './undo';

export interface UndoBinding {
  /** The live controller for the current document. */
  readonly undo: UndoController;
  /** Bumps on every history change; read it to re-render on undo-stack changes. */
  readonly version: number;
}

/**
 * Create the undo controller for `doc` and re-render on history changes. Passing
 * a fresh `doc` (a reload) starts a fresh controller over an empty history; the
 * previous one is destroyed.
 */
export function useUndo(doc: Y.Doc, opts?: UndoOptions): UndoBinding {
  const ref = useRef<{ doc: Y.Doc; controller: UndoController } | null>(null);
  if (ref.current === null || ref.current.doc !== doc) {
    ref.current = { doc, controller: createUndo(doc, opts) };
  }
  const controller = ref.current.controller;

  const [version, setVersion] = useState(0);
  useEffect(() => {
    // A brand-new controller starts empty and emits nothing, so sync once by
    // bumping on mount to make sure the first paint reflects any adopted state.
    setVersion((v) => v + 1);
    return controller.onChange(() => setVersion((v) => v + 1));
  }, [controller]);

  useEffect(
    () => () => {
      controller.destroy();
    },
    [controller],
  );

  return { undo: controller, version };
}