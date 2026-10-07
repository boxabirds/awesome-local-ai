// useUndo (story 8, undo.controls): binds an UndoController to React.
// Subscribes to the controller's stack changes so the button states stay
// current, and exposes canUndo/canRedo gated on the edit lock (the buttons
// and shortcuts are unavailable while the board cannot be edited —
// undo.not_editable).

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { UndoController } from './undo';

export interface UndoApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/**
 * @param controller the per-board undo controller (one per board doc).
 * @param canEdit the story 4 edit gate; false disables undo and redo.
 */
export function useUndo(controller: UndoController, canEdit: boolean): UndoApi {
  const subscribe = useCallback((cb: () => void) => controller.onChange(cb), [controller]);
  // A primitive, stable snapshot (required by useSyncExternalStore): one
  // character per state bit, so it only changes when a bit flips.
  const state = useSyncExternalStore(
    subscribe,
    () =>
      (canEdit ? '1' : '0') + (controller.canUndo() ? '1' : '0') + (controller.canRedo() ? '1' : '0'),
  );
  const [editable, hasUndo, hasRedo] = [
    state.charAt(0) === '1',
    state.charAt(1) === '1',
    state.charAt(2) === '1',
  ];
  const canUndo = editable && hasUndo;
  const canRedo = editable && hasRedo;

  // Keep one stable API object per (canEdit, canUndo, canRedo) triple; the
  // closures capture the current controller and edit gate, so the object is
  // refreshed whenever any of them changes.
  const apiKey = `${canEdit}|${canUndo}|${canRedo}`;
  const apiRef = useRef<{ key: string; value: UndoApi } | null>(null);
  if (apiRef.current === null || apiRef.current.key !== apiKey) {
    apiRef.current = {
      key: apiKey,
      value: {
        canUndo,
        canRedo,
        undo: () => {
          if (canEdit) controller.undo();
        },
        redo: () => {
          if (canEdit) controller.redo();
        },
      },
    };
  }
  return apiRef.current.value;
}
