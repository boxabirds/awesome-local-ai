import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

// --- Reducer ---

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
      // Click replaces the selection with just this id
      return { ids: new Set([action.id]), editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // If the removed id was being edited, stop editing
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
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      // Non-additive: replace selection. End editing if edited id is removed.
      const next = new Set(action.ids);
      const editing = state.editingId && next.has(state.editingId) ? state.editingId : null;
      return { ids: next, editingId: editing };
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      // If the currently-edited id was pruned, end editing
      const editing = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids: next, editingId: editing };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      // Ensure the edited id is in the selection
      const next = new Set(state.ids);
      next.add(action.id);
      return { ids: next, editingId: action.id };
    }
    default:
      return state;
  }
}

// --- Hook ---

export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
  /** Alias for click, kept for backward compatibility */
  select(id: string | null): void;
}

const initialState: SelectionState = { ids: new Set(), editingId: null };

/**
 * Local per-client selection and editing state (story 7). Never written to the Y.Doc.
 * Supports multi-selection via click, toggle, setMany, and prune (remote deletes).
 */
export function useSelection(snapshot?: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune on snapshot change: ids deleted by other people leave the selection
  useEffect(() => {
    if (!snapshot) return;
    const presentIds = new Set(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', presentIds });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next?: 'selected' | 'unselected') => {
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    } else {
      dispatch({ type: 'edit', id: null });
    }
  }, []);

  // Backward-compatible select(id) for old callers: null clears, string clicks
  const select = useCallback((id: string | null) => {
    if (id === null) dispatch({ type: 'clear' });
    else dispatch({ type: 'click', id });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit, select };
}
