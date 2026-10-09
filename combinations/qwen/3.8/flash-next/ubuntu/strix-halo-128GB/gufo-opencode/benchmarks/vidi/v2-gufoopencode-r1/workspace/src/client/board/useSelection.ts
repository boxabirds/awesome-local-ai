import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

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

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: null };
    case 'toggle': {
      if (state.ids.has(action.id)) {
        const ids = new Set(state.ids);
        ids.delete(action.id);
        return { ids, editingId: state.editingId === action.id ? null : state.editingId };
      }
      const ids = new Set(state.ids);
      ids.add(action.id);
      return { ids, editingId: state.editingId };
    }
    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      return { ids, editingId: state.editingId };
    }
    case 'clear':
      return { ids: EMPTY_IDS, editingId: null };
    case 'prune': {
      let dropped = false;
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
        else dropped = true;
      }
      const editGone = state.editingId !== null && !action.presentIds.has(state.editingId);
      if (!dropped && !editGone) return state;
      return { ids, editingId: editGone ? null : state.editingId };
    }
    case 'edit': {
      if (action.id === null) return { ids: state.ids, editingId: null };
      // Editing an object always operates on it alone: entering edit mode
      // (by creation or double-click) collapses the selection to it.
      return { ids: new Set([action.id]), editingId: action.id };
    }
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
  endEdit(next: EndEditNext): void;
}

// Selection and editing are per-client UI state, never written to the Y.Doc.
// A snapshot change dispatches `prune`, so ids deleted by anyone (locally or
// remotely) leave the selection, and editing a vanished object ends.
export function useSelection(objects: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, { ids: EMPTY_IDS, editingId: null });
  const presentIds = useMemo(() => new Set(objects.map((obj) => obj.id)), [objects]);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: EndEditNext) => {
    if (next === 'unselected') dispatch({ type: 'clear' });
    else dispatch({ type: 'edit', id: null });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
