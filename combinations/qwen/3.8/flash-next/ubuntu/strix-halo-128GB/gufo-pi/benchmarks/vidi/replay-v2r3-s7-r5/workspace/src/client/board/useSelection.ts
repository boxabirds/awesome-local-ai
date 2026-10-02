import { useCallback, useEffect, useReducer } from 'react';
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

const initialState: SelectionState = { ids: new Set(), editingId: null };

/**
 * Pure reducer for selection state.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Click replaces the set with just this id
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      // Shift-click: add or remove
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: null };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: null };
      }
      return { ids: new Set(action.ids), editingId: null };
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      // If editingId was pruned, end editing
      const newEditingId = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      // Only return a new state if something actually changed
      if (next.size === state.ids.size && newEditingId === state.editingId) {
        let same = true;
        for (const id of state.ids) {
          if (!next.has(id)) { same = false; break; }
        }
        if (same) return state;
      }
      return { ids: next, editingId: newEditingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ...state, editingId: null };
      }
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
  endEdit(): void;
  /** Compatibility with old API: selectedId for single selection contexts */
  selectedId: string | null;
  select(id: string | null): void;
}

/**
 * Per-client multi-selection state. Prunes ids that are no longer present in the
 * snapshot (remote deletes). Never written to the Y.Doc.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune when snapshot changes (objects deleted remotely)
  useEffect(() => {
    const presentIds = new Set(snapshot.map((o) => o.id));
    if (state.ids.size > 0) {
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  // Backward compat: selectedId for single-selection contexts
  const selectedId = state.ids.size === 1 ? [...state.ids][0] : null;
  const select = useCallback((id: string | null) => {
    if (id === null) dispatch({ type: 'clear' });
    else dispatch({ type: 'click', id });
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
    selectedId,
    select,
  };
}
