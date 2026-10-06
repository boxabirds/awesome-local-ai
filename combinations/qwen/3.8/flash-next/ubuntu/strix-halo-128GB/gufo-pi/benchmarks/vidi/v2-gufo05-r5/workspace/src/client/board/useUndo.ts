/**
 * React view over the undo controller.
 *
 * Stack changes arrive as commands are captured, undone and redone, and those can land in the
 * middle of a transaction; rather than reasoning about where a `setState` is safe, the flags are
 * synced in a microtask. `canUndo`/`canRedo` exist so the toolbar can show that a command would
 * do nothing (PRD: Undo and Redo SHALL show that they do nothing when there is nothing to undo).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UndoController } from './undo';

export interface UndoActions {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** Close the current step. A no-op on a board that cannot be edited. */
  boundary(): void;
  /** The controller itself, or null while this board cannot be edited. */
  controller: UndoController | null;
}

export function useUndo(controller: UndoController | null, canEdit: boolean): UndoActions {
  const active = canEdit ? controller : null;
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setFlags({ canUndo: false, canRedo: false });
      return;
    }
    let queued = false;
    const sync = (): void => {
      if (queued) return;
      queued = true;
      // eslint-disable-next-line no-void
      void Promise.resolve().then(() => {
        queued = false;
        if (mounted.current) {
          setFlags({ canUndo: active.canUndo(), canRedo: active.canRedo() });
        }
      });
    };
    sync();
    return active.onChange(sync);
  }, [active]);

  const undo = useCallback(() => {
    active?.undo();
  }, [active]);

  const redo = useCallback(() => {
    active?.redo();
  }, [active]);

  const boundary = useCallback(() => {
    active?.boundary();
  }, [active]);

  // Memoised so callers can hold this object in a dependency list: the keyboard listener that
  // takes `undo` would otherwise re-attach on every render.
  return useMemo(
    () => ({
      canUndo: active !== null && flags.canUndo,
      canRedo: active !== null && flags.canRedo,
      undo,
      redo,
      boundary,
      controller: active,
    }),
    [active, flags.canUndo, flags.canRedo, undo, redo, boundary],
  );
}
