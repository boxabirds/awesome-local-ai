import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

// --- Pure reducer ---

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
      const ids = new Set([action.id]);
      const editingId = state.editingId === action.id ? state.editingId : null;
      return { ids, editingId };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
        const editingId = state.editingId === action.id ? null : state.editingId;
        return { ids, editingId };
      } else {
        ids.add(action.id);
        return { ids, editingId: state.editingId };
      }
    }
    case 'setMany': {
      if (action.additive) {
        if (action.ids.length === 0) return state;
        const ids = new Set(state.ids);
        for (const id of action.ids) ids.add(id);
        return { ids, editingId: state.editingId };
      } else {
        const ids = new Set(action.ids);
        const editingId = state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
        return { ids, editingId };
      }
    }
    case 'clear':
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    case 'prune': {
      let changed = false;
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
        else changed = true;
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
        changed = true;
      }
      if (!changed) return state;
      return { ids, editingId };
    }
    case 'edit':
      return { ids: state.ids, editingId: action.id };
    default:
      return state;
  }
}

// --- useSelection hook ---

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
 * Multi-selection state for the board. Deliberately local: never written to the Y.Doc.
 * Prunes ids that no longer exist in the snapshot (remote deletes).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, { ids: new Set<string>(), editingId: null });

  // Prune ids that no longer exist in the snapshot.
  const prevSnapshotRef = useRef(snapshot);
  useEffect(() => {
    if (snapshot === prevSnapshotRef.current) return;
    prevSnapshotRef.current = snapshot;
    if (state.ids.size > 0 || state.editingId !== null) {
      const presentIds = new Set(snapshot.map((o) => o.id));
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot, state.ids, state.editingId]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return useMemo(() => ({
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  }), [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit]);
}
