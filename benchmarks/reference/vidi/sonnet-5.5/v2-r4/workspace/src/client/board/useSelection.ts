import { useCallback, useEffect, useMemo, useReducer } from 'react';
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
  | { type: 'select'; id: string }
  | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) return state;
      return { ids: new Set([action.id]), editingId: state.editingId === action.id ? action.id : null };
    case 'toggle': {
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ids, editingId: ids.size === 1 && ids.has(state.editingId ?? '') ? state.editingId : null };
    }
    case 'setMany': {
      if (action.additive && action.ids.length === 0) return state;
      const ids = new Set(action.additive ? state.ids : []);
      action.ids.forEach((id) => ids.add(id));
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id)) && state.editingId === null) return state;
      return { ids, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const kept = [...state.ids].filter((id) => action.presentIds.has(id));
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (kept.length === state.ids.size && editingId === state.editingId) return state;
      return { ids: new Set(kept), editingId };
    }
    case 'select':
      return { ids: new Set([action.id]), editingId: null };
    case 'edit':
      return action.id === null ? (state.editingId === null ? state : { ...state, editingId: null }) : { ids: new Set([action.id]), editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  /** Makes `id` the only selected object, even before the snapshot has seen it (a tool just created it). */
  select(id: string): void;
  startEdit(id: string): void;
  /** `'unselected'` also clears the selection (story 2: Escape-less exits such as an emptied-out edit). */
  endEdit(next?: 'selected' | 'unselected'): void;
}

/** Local selection and editing state; never stored in the document. Ids that leave the snapshot drop out. */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  useEffect(() => dispatch({ type: 'prune', presentIds: present }), [present]);

  // Actions naming an id that is not on the board are ignored.
  const presentRef = useMemo(() => ({ current: present }), []);
  presentRef.current = present;

  const click = useCallback((id: string) => presentRef.current.has(id) && dispatch({ type: 'click', id }), [presentRef]);
  const toggle = useCallback((id: string) => presentRef.current.has(id) && dispatch({ type: 'toggle', id }), [presentRef]);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids: ids.filter((id) => presentRef.current.has(id)), additive }),
    [presentRef],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  // Not filtered: a note is created and put into edit mode before the snapshot has seen it (prune covers a bad id).
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => dispatch(next === 'selected' ? { type: 'edit', id: null } : { type: 'clear' }), []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, select, startEdit, endEdit }),
    [state, click, toggle, setMany, clear, select, startEdit, endEdit],
  );
}
