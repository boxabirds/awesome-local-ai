import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
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

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      if (state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ids: new Set([action.id]), editingId: state.editingId === action.id ? state.editingId : null };
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ids, editingId: null };
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) ids.add(id);
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id))) {
        return action.additive ? state : { ...state, editingId: ids.size === 1 ? state.editingId : null };
      }
      return { ids, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
      return ids.size === state.ids.size && editingId === state.editingId ? state : { ids, editingId };
    }
    case 'edit':
      return action.id === null ? { ...state, editingId: null } : { ids: new Set([action.id]), editingId: action.id };
  }
}

export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const present = useRef<ReadonlySet<string>>(new Set());
  present.current = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);

  // Objects deleted by anyone (including remotely) leave the selection; the rest stay selected.
  useEffect(() => dispatch({ type: 'prune', presentIds: present.current }), [snapshot]);

  const click = useCallback((id: string) => present.current.has(id) && dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => present.current.has(id) && dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) =>
      dispatch({ type: 'setMany', ids: ids.filter((id) => present.current.has(id)), additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  // Not filtered: a just-created note starts editing before the snapshot that contains it has rendered.
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next?: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [state, click, toggle, setMany, clear, startEdit, endEdit],
  );
}

export type Selection = ReturnType<typeof useSelection>;
