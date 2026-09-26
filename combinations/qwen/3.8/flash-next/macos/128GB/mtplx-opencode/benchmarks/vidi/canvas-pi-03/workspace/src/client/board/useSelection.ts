import { useCallback, useMemo, useRef, useState } from 'react';
import { SelectionController } from './selection-controller';

/**
 * Local, per-client selection + editing state for the board. This is NEVER
 * written to the Y.Doc: a user's selection is not board data (shared selection
 * presence is a later story).
 *
 * Story 7 grew this from a single `selectedId` to a SET of ids owned by a
 * framework-free `SelectionController`. `selectedId` is kept as the "primary"
 * id (the last-selected one, null when nothing is selected) so the story-1..6
 * components that only understood a single selection keep working unchanged.
 * `editingId` still tracks the one note being text-edited.
 */
export interface SelectionState {
  /** Primary selected id (null when the set is empty). Kept for back-compat. */
  selectedId: string | null;
  editingId: string | null;
  /** Every selected id (new array each render). */
  ids: readonly string[];
  /** Make `id` the only selection (null clears). Leaves edit mode. */
  select(id: string | null): void;
  /** Replace the whole selection; `additive` unions with the current set. */
  setSelection(ids: Iterable<string>, additive?: boolean): void;
  /** Toggle one id in the set (Shift / Cmd/Ctrl click). */
  toggle(id: string): void;
  /** Select and begin text-editing `id` (only that note is selected). */
  startEdit(id: string): void;
  /** Stop editing; 'selected' keeps the selection, 'unselected' clears it. */
  endEdit(next: 'selected' | 'unselected'): void;
  /** Clear the selection and any armed gesture. */
  clear(): void;
  /** The framework-free controller (hit-test / press classification). */
  controller: SelectionController;
}

export function useSelection(): SelectionState {
  const controllerRef = useRef<SelectionController>(new SelectionController());
  const controller = controllerRef.current;

  const [ids, setIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Mirror the controller's set into React state so the UI re-renders.
  const sync = useCallback(() => {
    setIds(controller.getSelection());
  }, [controller]);

  const select = useCallback(
    (id: string | null) => {
      if (id === null) controller.clear();
      else controller.setSelection([id]);
      setEditingId(null);
      sync();
    },
    [controller, sync],
  );

  const setSelection = useCallback(
    (next: Iterable<string>, additive = false) => {
      controller.applyMarquee(next, additive);
      setEditingId(null);
      sync();
    },
    [controller, sync],
  );

  const toggle = useCallback(
    (id: string) => {
      controller.press({ point: { x: 0, y: 0 }, shift: true, meta: false, ctrl: false, hitId: id });
      setEditingId(null);
      sync();
    },
    [controller, sync],
  );

  const startEdit = useCallback(
    (id: string) => {
      controller.setSelection([id]);
      setEditingId(id);
      sync();
    },
    [controller, sync],
  );

  const endEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      setEditingId(null);
      if (next === 'unselected') {
        controller.clear();
        sync();
      }
    },
    [controller, sync],
  );

  const clear = useCallback(() => {
    controller.clear();
    setEditingId(null);
    sync();
  }, [controller, sync]);

  const selectedId = useMemo(() => {
    // Primary id = the last-inserted one.
    let last: string | null = null;
    for (const id of ids) last = id;
    return last;
  }, [ids]);

  return {
    selectedId,
    editingId,
    ids,
    select,
    setSelection,
    toggle,
    startEdit,
    endEdit,
    clear,
    controller,
  };
}