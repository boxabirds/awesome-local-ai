import { useCallback, useEffect, useReducer, useRef } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

/**
 * Story 8 (undo.controls / undo.session_only): owns the per-board
 * UndoController for the lifetime of `doc` and exposes its reactive state.
 *
 * The controller is created once per `doc` (Board remounts on board change,
 * so a fresh controller — and an empty history — follows each board). It is
 * destroyed on unmount. `canUndo`/`canRedo` re-render on every stack change
 * via the controller's `onChange`.
 */
export function useUndo(doc: Y.Doc): {
  controller: UndoController;
  canUndo: boolean;
  canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
  boundary(): void;
} {
  const ref = useRef<UndoController | null>(null);
  if (ref.current === null) {
    ref.current = createUndo(doc);
  }
  const controller = ref.current;

  // Destroy on unmount (the doc goes with the Board).
  useEffect(() => {
    const c = ref.current;
    return () => {
      c?.destroy();
      if (ref.current === c) ref.current = null;
    };
  }, []);

  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => controller.onChange(force), [controller]);

  const undo = useCallback(() => controller.undo(), [controller]);
  const redo = useCallback(() => controller.redo(), [controller]);
  const boundary = useCallback(() => controller.boundary(), [controller]);

  return {
    controller,
    canUndo: controller.canUndo(),
    canRedo: controller.canRedo(),
    undo,
    redo,
    boundary,
  };
}
