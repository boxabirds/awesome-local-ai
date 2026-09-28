/**
 * Local multi-selection and editing state (story 7).
 *
 * Never stored in the Y.Doc: other users must not see my selection as data
 * (presence of selection is a later story). `selectionReducer` is pure so it can
 * be unit tested; `useSelection` wires it to a live snapshot and prunes ids that
 * other people delete.
 */
import { useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

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

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/** Keep editingId only while it is still part of the selection. */
function keepEditing(ids: ReadonlySet<string>, editingId: string | null): string | null {
  return editingId !== null && ids.has(editingId) ? editingId : null;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      return { ids, editingId: keepEditing(ids, state.editingId) };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: keepEditing(ids, state.editingId) };
    }
    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      return { ids, editingId: keepEditing(ids, state.editingId) };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      // No-op when nothing was pruned (stable reference).
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      const ids = state.ids.has(action.id) ? state.ids : new Set(state.ids).add(action.id);
      return { ids, editingId: action.id };
    }
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * Selection state bound to a live object snapshot. A snapshot change dispatches
 * `prune`, so ids deleted by other people leave the selection (and editing of a
 * pruned id ends).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Prune on every snapshot change (ids removed remotely).
  useEffect(() => {
    const present = new Set(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const actions = useMemo<SelectionApi>(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      click: (id) => dispatch({ type: 'click', id }),
      toggle: (id) => dispatch({ type: 'toggle', id }),
      setMany: (ids, additive) => dispatch({ type: 'setMany', ids, additive }),
      clear: () => dispatch({ type: 'clear' }),
      startEdit: (id) => dispatch({ type: 'edit', id }),
      endEdit: (next = 'selected') =>
        dispatch(next === 'unselected' ? { type: 'clear' } : { type: 'edit', id: null }),
    }),
    [state],
  );

  return actions;
}
