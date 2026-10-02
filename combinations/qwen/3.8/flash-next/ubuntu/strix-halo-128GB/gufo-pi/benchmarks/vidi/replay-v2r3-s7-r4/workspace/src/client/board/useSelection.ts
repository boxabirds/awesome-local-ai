import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

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

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * Pure reducer for the per-client selection (never written to the Y.Doc).
 * `click` replaces the set; `toggle` adds or removes one id; `setMany` unions or
 * replaces; `prune` drops ids that no longer exist (remote delete); `edit`
 * enters/leaves text editing. Actions that change nothing return the same object
 * so React can bail out of a re-render (important for the prune effect).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const has = state.ids.has(action.id);
      const ids = new Set(state.ids);
      if (has) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = action.id === state.editingId && has ? null : state.editingId;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = new Set<string>(action.additive ? state.ids : []);
      for (const id of action.ids) ids.add(id);
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id))) {
        return state;
      }
      return { ids, editingId: null };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return EMPTY;
    }
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      const same =
        state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id);
      if (same) return state;
      return { ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: EndEditNext): void;
}

/**
 * Local per-client selection and editing state, as a *set* of ids (story 7).
 * A snapshot change prunes ids deleted by other people (sel.remote_delete);
 * editing an object that vanishes ends editing. Never written to the document.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY);

  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);

  // Ids deleted by other people leave the selection; editing a gone object ends.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(
    (next: EndEditNext = 'selected') =>
      dispatch(next === 'unselected' ? { type: 'clear' } : { type: 'edit', id: null }),
    [],
  );

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
