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

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      return { ids, editingId: null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      // If the toggled id was being edited, stop editing
      const editingId = ids.has(state.editingId ?? '') ? state.editingId : null;
      return { ids, editingId };
    }
    case 'setMany': {
      if (action.additive) {
        const ids = new Set(state.ids);
        for (const id of action.ids) ids.add(id);
        return { ids, editingId: state.editingId };
      } else {
        const ids = new Set(action.ids);
        return { ids, editingId: null };
      }
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
      }
      // If the editing id was pruned, stop editing
      const editingId = ids.has(state.editingId ?? '') ? state.editingId : null;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      const ids = new Set(state.ids);
      ids.add(action.id);
      return { ids, editingId: action.id };
    }
    default:
      return state;
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
 * Local per-client selection and editing state. Never written to the Y.Doc:
 * every person on a shared board (story 3) selects different notes.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune ids not present in snapshot (remote deletes)
  useEffect(() => {
    if (state.ids.size > 0) {
      const presentIds = new Set(snapshot.map((obj) => obj.id));
      let needsPrune = false;
      for (const id of state.ids) {
        if (!presentIds.has(id)) {
          needsPrune = true;
          break;
        }
      }
      if (needsPrune) {
        dispatch({ type: 'prune', presentIds });
      }
    }
  }, [snapshot, state.ids]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

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
