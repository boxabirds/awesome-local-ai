import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Per-client selection state. Never stored in the Y.Doc — selections
 * and editing state are personal (live.local_selection).
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
 * Pure selection reducer. Handles click, toggle, setMany, clear, prune, edit.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Replace the set with just this id
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
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
        if (action.ids.length === 0) return state; // no change
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: null };
      } else {
        return { ids: new Set(action.ids), editingId: null };
      }
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      // Remove ids that are no longer present
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId)
          ? null
          : state.editingId;
      return { ids: next, editingId };
    }
    case 'edit': {
      return { ...state, editingId: action.id };
    }
  }
}

/**
 * Hook that manages multi-selection state with pruning on snapshot changes.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  // Prune: when the snapshot changes, remove ids that no longer exist
  useEffect(() => {
    const presentIds = new Set(snapshot.map((o) => o.id));
    // Only dispatch prune if something would actually change
    let needsPrune = false;
    for (const id of state.ids) {
      if (!presentIds.has(id)) {
        needsPrune = true;
        break;
      }
    }
    if (state.editingId !== null && !presentIds.has(state.editingId)) {
      needsPrune = true;
    }
    if (needsPrune) {
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

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
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    }
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
