import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Board selection (story 7, sel.state): a SET of object ids (multi-select)
 * plus the editing id. Pure reducer for unit testing; the hook filters every
 * action against the live snapshot so remote deletions never resurrect ids,
 * and prunes the selection automatically when objects disappear.
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      // A plain click always collapses to a single-selection.
      return { ids: new Set([action.id]), editingId: null };
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      const next = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) next.add(id);
      return { ids: next, editingId: state.editingId };
    }
    case 'clear':
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else changed = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (!changed && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'edit':
      if (action.id === state.editingId) return state;
      return { ids: state.ids, editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Plain click: select only this object. */
  click(id: string): void;
  /** Shift-click / ctrl-click: add or remove this object. */
  toggle(id: string): void;
  /** Marquee (additive) or select-all (replacing). */
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
  /**
   * Select and start editing an object that was just created and is not yet in
   * the snapshot the hook validated against. The caller guarantees the id
   * exists in the doc (createSticky succeeded).
   */
  selectAndEdit(id: string): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const presentIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);

  // Remote deletion / unknown objects: prune automatically.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'click', id });
    },
    [presentIds]
  );
  const toggle = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'toggle', id });
    },
    [presentIds]
  );
  const setMany = useCallback(
    (ids: string[], additive: boolean) => {
      const present = ids.filter((id) => presentIds.has(id));
      if (present.length > 0 || !additive) {
        dispatch({ type: 'setMany', ids: present, additive });
      }
    },
    [presentIds]
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'edit', id });
    },
    [presentIds]
  );
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);
  const selectAndEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
    selectAndEdit,
  };
}
