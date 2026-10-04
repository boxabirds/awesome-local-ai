import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Multi-selection state: a set of selected object ids plus an editing id.
 * Local state only; never written to the Y.Doc.
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

/**
 * Pure selection reducer.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      const editingId = state.editingId === action.id ? null : state.editingId;
      return { ids: next, editingId };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      } else {
        return { ids: new Set(action.ids), editingId: null };
      }
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingId = state.editingId && !action.presentIds.has(state.editingId) ? null : state.editingId;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ...state, editingId: null };
      }
      return { ids: new Set([action.id]), editingId: action.id };
    }
  }
}

const initialSelectionState: SelectionState = { ids: new Set(), editingId: null };

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
 * Multi-selection hook. Prunes ids that no longer exist in the snapshot
 * (e.g. deleted by another user).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialSelectionState);

  // Prune selection when snapshot changes (remote deletes)
  useEffect(() => {
    const presentIds = new Set(snapshot.map((s) => s.id));
    // Only dispatch prune if something would actually change
    let needsPrune = false;
    for (const id of state.ids) {
      if (!presentIds.has(id)) { needsPrune = true; break; }
    }
    if (state.editingId && !presentIds.has(state.editingId)) needsPrune = true;
    if (needsPrune) {
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot, state.ids, state.editingId]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
