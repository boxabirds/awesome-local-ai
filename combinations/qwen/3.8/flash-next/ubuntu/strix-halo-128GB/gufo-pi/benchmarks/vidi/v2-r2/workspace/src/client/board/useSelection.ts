import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';

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
      const newIds = new Set<string>([action.id]);
      return { ids: newIds, editingId: state.editingId && newIds.has(state.editingId) ? state.editingId : null };
    }
    case 'toggle': {
      const newIds = new Set(state.ids);
      if (newIds.has(action.id)) {
        newIds.delete(action.id);
        // If editing id was removed, end editing
        const newEditing = state.editingId === action.id ? null : state.editingId;
        return { ids: newIds, editingId: newEditing };
      } else {
        newIds.add(action.id);
        return { ids: newIds, editingId: state.editingId };
      }
    }
    case 'setMany': {
      if (action.additive) {
        const newIds = new Set(state.ids);
        for (const id of action.ids) newIds.add(id);
        return { ids: newIds, editingId: state.editingId };
      } else {
        const newIds = new Set(action.ids);
        const newEditing = state.editingId && newIds.has(state.editingId) ? state.editingId : null;
        return { ids: newIds, editingId: newEditing };
      }
    }
    case 'clear':
      return { ids: new Set<string>(), editingId: null };
    case 'prune': {
      const newIds = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) newIds.add(id);
      }
      const newEditing = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids: newIds, editingId: newEditing };
    }
    case 'edit':
      if (action.id === null) return { ...state, editingId: null };
      // startEdit also ensures the note is selected
      return { ids: new Set([action.id]), editingId: action.id };
  }
}

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

export function useSelection(snapshotArr: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  // Prune selection when snapshot changes (remote deletions)
  const presentIdsRef = useRef<string>("");
  useEffect(() => {
    const key = snapshotArr.map((o) => o.id).sort().join(',');
    if (key !== presentIdsRef.current) {
      presentIdsRef.current = key;
      const presentIds = new Set(snapshotArr.map((o) => o.id));
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshotArr]);

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
