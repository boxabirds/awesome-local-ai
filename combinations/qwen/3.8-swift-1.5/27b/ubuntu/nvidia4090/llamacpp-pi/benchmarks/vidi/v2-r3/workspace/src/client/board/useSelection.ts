import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Story 7 (sel.multi): local selection state — a Set of object ids plus the
 * id currently in text-edit mode (at most one). Pure reducer + a thin hook
 * wrapper; all the decisions live in `selectionReducer` (unit-tested).
 *
 * Selection is per-client UI state (not synced). It is pruned whenever the
 * board snapshot changes: ids that no longer exist (locally or remotely
 * deleted) drop out, which also ends editing of a deleted object (TC-35).
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; present: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export function initialSelectionState(): SelectionState {
  return { ids: new Set<string>(), editingId: null };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      const next = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) next.add(id);
      return { ids: next, editingId: state.editingId };
    }
    case 'clear':
      return { ids: new Set<string>(), editingId: null };
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.present.has(id)) next.add(id);
        else changed = true;
      }
      const editingGone = state.editingId !== null && !action.present.has(state.editingId);
      if (!changed && !editingGone) return state;
      return {
        ids: next,
        editingId: editingGone ? null : state.editingId,
      };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      const next = new Set(state.ids);
      next.add(action.id);
      return { ids: next, editingId: action.id };
    }
  }
}

export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, undefined, initialSelectionState);

  // Prune ids that no longer exist (local delete, remote delete, prune).
  useEffect(() => {
    dispatch({ type: 'prune', present: new Set(snapshot.map((o) => o.id)) });
  }, [snapshot]);

  const click = useCallback(
    (id: string) => {
      if (!snapshot.some((o) => o.id === id)) return; // ghost id → ignored
      dispatch({ type: 'click', id });
    },
    [snapshot],
  );

  const toggle = useCallback(
    (id: string) => {
      if (!snapshot.some((o) => o.id === id)) return;
      dispatch({ type: 'toggle', id });
    },
    [snapshot],
  );

  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => {
      dispatch({ type: 'setMany', ids, additive });
    },
    [],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  // No snapshot validation here: create→startEdit happens in the same tick,
  // before the snapshot ref re-renders. A ghost id would be pruned anyway.
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return useMemo(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      click,
      toggle,
      setMany,
      clear,
      startEdit,
      endEdit,
    }),
    [state, click, toggle, setMany, clear, startEdit, endEdit],
  );
}

export type SelectionApi = ReturnType<typeof useSelection>;
