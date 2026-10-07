import { useState, useCallback, useEffect, useReducer } from 'react';

/** Action types for the selection reducer. */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

/** Current selection state (not persisted in Y.Doc). */
export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

const initialState: SelectionState = {
  ids: new Set() as ReadonlySet<string>,
  editingId: null,
};

/**
 * Pure reducer for selection actions.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ...initialState, ids: new Set([action.id]) as ReadonlySet<string> };
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ...state, ids: next as ReadonlySet<string> };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) {
          next.add(id);
        }
        return { ...state, ids: next as ReadonlySet<string> };
      }
      return { ...state, ids: new Set(action.ids) as ReadonlySet<string> };
    }
    case 'clear':
      return { ...initialState, ids: new Set() as ReadonlySet<string> };
    case 'prune': {
      const filtered = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          filtered.add(id);
        }
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
      }
      return { ...state, ids: filtered as ReadonlySet<string>, editingId };
    }
    case 'edit':
      return { ...state, editingId: action.id };
    default:
      return state;
  }
}

/**
 * Multi-selection hook backed by a snapshot effect that prunes deleted objects.
 */
export function useSelection(
  snapshot: readonly unknown[],
): {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
} {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune on snapshot changes — when remote deletes happen, remove those ids
  useEffect(() => {
    const presentIds = new Set<string>();
    for (const obj of snapshot as Array<{ id?: string }>) {
      if (obj.id) {
        presentIds.add(obj.id);
      }
    }
    if (presentIds.size > 0) {
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot]);

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
