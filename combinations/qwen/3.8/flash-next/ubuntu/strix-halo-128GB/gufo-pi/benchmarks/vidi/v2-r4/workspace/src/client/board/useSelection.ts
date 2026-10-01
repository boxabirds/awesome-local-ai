import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
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
      const next = new Set<string>([action.id]);
      return { ids: next, editingId: state.editingId };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // If we removed the editing id, end editing
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
      const next = new Set<string>(action.ids);
      return { ids: next, editingId: state.editingId };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
        changed = true;
      }
      if (!changed) return state;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      // Select the id being edited
      const next = new Set(state.ids);
      next.add(action.id);
      return { ids: next, editingId: action.id };
    }
    default:
      return state;
  }
}

const initialState: SelectionState = { ids: new Set(), editingId: null };

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune deleted objects from selection when snapshot changes
  useEffect(() => {
    const presentIds = new Set(snapshot.map((o) => o.id));
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

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
