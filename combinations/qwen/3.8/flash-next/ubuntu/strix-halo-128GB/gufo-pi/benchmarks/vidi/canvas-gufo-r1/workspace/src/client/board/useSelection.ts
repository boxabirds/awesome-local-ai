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
  | { type: 'edit'; id: string | null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Replace selection with just this id
      return { ids: new Set([action.id]), editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // If the removed id was being edited, end editing
        if (state.editingId === action.id) {
          return { ids: next, editingId: null };
        }
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      if (action.additive) {
        if (action.ids.length === 0) return state;
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      } else {
        // Non-additive: replace
        const next = new Set(action.ids);
        return { ids: next, editingId: next.has(state.editingId!) ? state.editingId : null };
      }
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
      }
      // If nothing changed, return same state reference for React optimization
      if (next.size === state.ids.size) {
        let same = true;
        for (const id of state.ids) {
          if (!next.has(id)) { same = false; break; }
        }
        if (same && editingId === state.editingId) return state;
      }
      return { ids: next, editingId };
    }
    case 'edit':
      return { ids: state.ids, editingId: action.id };
  }
}

const initialState: SelectionState = { ids: new Set(), editingId: null };

export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * Multi-selection state hook. Accepts the current object snapshot for pruning.
 * Selection is purely local and never written to the Y.Doc.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune selection when snapshot changes (remote deletes)
  const snapshotIds = useMemo(() => {
    const set = new Set<string>();
    for (const obj of snapshot) set.add(obj.id);
    return set;
  }, [snapshot]);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds: snapshotIds });
  }, [snapshotIds]);

  const click = useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback(() => {
    dispatch({ type: 'edit', id: null });
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
  };
}
