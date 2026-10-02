import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

// ---------- Types ----------

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

// ---------- Reducer (pure) ----------

const EMPTY_STATE: SelectionState = { ids: new Set(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const next = new Set<string>();
      next.add(action.id);
      return { ids: next, editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // If we removed the editing id, stop editing
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
      } else {
        const next = new Set(action.ids);
        // If editing an id that's no longer selected, stop editing
        if (state.editingId && !next.has(state.editingId)) {
          return { ids: next, editingId: null };
        }
        return { ids: next, editingId: state.editingId };
      }
    }
    case 'clear':
      return EMPTY_STATE;
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      let editingId = state.editingId;
      if (editingId && !action.presentIds.has(editingId)) {
        editingId = null;
      }
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      // Ensure the editing id is in the selection
      const next = new Set(state.ids);
      next.add(action.id);
      return { ids: next, editingId: action.id };
    }
    default:
      return state;
  }
}

// ---------- Hook ----------

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
 * Local per-client multi-selection and editing state. Never written to the Y.Doc:
 * every person on a shared board (story 3) selects different notes.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_STATE);

  // Prune selection when the snapshot changes (remote deletions)
  useEffect(() => {
    const presentIds = new Set(snapshot.map((obj) => obj.id));
    dispatch({ type: 'prune', presentIds });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
