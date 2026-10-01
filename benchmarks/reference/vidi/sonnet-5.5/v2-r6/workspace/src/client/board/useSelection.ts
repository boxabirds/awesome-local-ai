import { useCallback, useLayoutEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Ids known to exist; null until the first prune, when every id is accepted. */
  present: ReadonlySet<string> | null;
}

export type SelectionAction =
  | { type: 'click'; id: string } | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean } | { type: 'clear' } | { type: 'select'; id: string }
  | { type: 'prune'; presentIds: ReadonlySet<string> } | { type: 'edit'; id: string | null }
  | { type: 'endEdit'; keepSelection: boolean };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null, present: null };

const known = (s: SelectionState, id: string) => s.present === null || s.present.has(id);

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!known(state, action.id)) return state;
      const editingId = state.editingId === action.id ? action.id : null;
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === editingId) return state;
      return { ...state, ids: new Set([action.id]), editingId };
    }
    case 'select': // an object just created here: not in the pruned set until the next snapshot
      return { ...state, ids: new Set([action.id]), editingId: null };
    case 'toggle': {
      if (!known(state, action.id)) return state;
      const ids = new Set(state.ids);
      if (!ids.delete(action.id)) ids.add(action.id);
      return { ...state, ids, editingId: null };
    }
    case 'setMany': {
      const wanted = action.ids.filter((id) => known(state, id));
      const ids = new Set(action.additive ? [...state.ids, ...wanted] : wanted);
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id))) return state;
      return { ...state, ids, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : { ...state, ids: new Set(), editingId: null };
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      const unchanged = ids.size === state.ids.size && editingId === state.editingId;
      return { ids: unchanged ? state.ids : ids, editingId, present: action.presentIds };
    }
    case 'edit':
      return action.id === null
        ? (state.editingId === null ? state : { ...state, editingId: null })
        : { ...state, ids: new Set([action.id]), editingId: action.id };
    case 'endEdit':
      return { ...state, ids: action.keepSelection ? state.ids : new Set(), editingId: null };
    default:
      return state;
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  /** Makes `id` the only selected object, even one created a moment ago that no snapshot has shown yet. */
  select(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
}

/** Local, per-client selection and editing state; never stored in the document. */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Objects deleted by other people (or anywhere) leave the selection; editing of a pruned id ends.
  useLayoutEffect(() => {
    dispatch({ type: 'prune', presentIds: new Set(snapshot.map((o) => o.id)) });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const select = useCallback((id: string) => dispatch({ type: 'select', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch({ type: 'endEdit', keepSelection: next === 'selected' });
  }, []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, select, setMany, clear, startEdit, endEdit }),
    [state.ids, state.editingId, click, toggle, select, setMany, clear, startEdit, endEdit],
  );
}
