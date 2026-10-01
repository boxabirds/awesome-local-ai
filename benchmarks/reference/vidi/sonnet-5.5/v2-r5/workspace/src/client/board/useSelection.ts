import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState { ids: ReadonlySet<string>; editingId: string | null }

export type SelectionAction =
  | { type: 'click'; id: string } | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean } | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> } | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

/** Editing only survives while the selection is exactly the edited object. */
function settle(ids: ReadonlySet<string>, editingId: string | null): SelectionState {
  return { ids, editingId: editingId !== null && ids.size === 1 && ids.has(editingId) ? editingId : null };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      if (state.ids.size === 1 && state.ids.has(action.id)) return state;
      return settle(new Set([action.id]), state.editingId);
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return settle(ids, state.editingId);
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      action.ids.forEach((id) => ids.add(id));
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id))) return state;
      return settle(ids, state.editingId);
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const kept = [...state.ids].filter((id) => action.presentIds.has(id));
      if (kept.length === state.ids.size) return state;
      return settle(new Set(kept), state.editingId);
    }
    case 'edit':
      if (action.id === null) return state.editingId === null ? state : { ...state, editingId: null };
      return { ids: new Set([action.id]), editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  /** Makes `id` the only selection without checking the snapshot (it may have been created a moment ago). */
  select(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
}

/** Per-client selection (never written to the doc). Ids of objects that disappear are pruned. */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef(present);
  presentRef.current = present;

  useEffect(() => { dispatch({ type: 'prune', presentIds: present }); }, [present]);

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);
  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);
  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids: ids.filter((id) => presentRef.current.has(id)), additive });
  }, []);
  const select = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  // Not checked against `present`: a note created a moment ago is not in the snapshot yet.
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch(next === 'selected' ? { type: 'edit', id: null } : { type: 'clear' });
  }, []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, select, toggle, setMany, clear, startEdit, endEdit }),
    [state, click, select, toggle, setMany, clear, startEdit, endEdit],
  );
}
