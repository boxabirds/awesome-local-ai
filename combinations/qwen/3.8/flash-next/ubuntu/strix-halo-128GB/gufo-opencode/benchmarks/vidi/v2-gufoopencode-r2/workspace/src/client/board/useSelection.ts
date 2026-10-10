// Per-client selection and editing state. Never written to the Y.Doc: every
// participant has their own selection. Story 7: a set of ids plus the one
// id (if any) whose text is being edited.

import { useCallback, useEffect, useMemo, useReducer } from 'react';
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

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
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
      if (state.ids.has(action.id)) {
        const ids = new Set(state.ids);
        ids.delete(action.id);
        const editingId = state.editingId === action.id ? null : state.editingId;
        if (ids.size === 0 && editingId === null) return EMPTY_SELECTION;
        return { ids, editingId };
      }
      return { ids: new Set([...state.ids, action.id]), editingId: null };
    }
    case 'setMany': {
      const next = new Set(action.additive ? [...state.ids, ...action.ids] : action.ids);
      const editingId =
        state.editingId !== null && next.has(state.editingId) ? state.editingId : null;
      if (sameIds(next, state.ids) && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'clear':
      return EMPTY_SELECTION;
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId)
          ? null
          : state.editingId;
      if (ids.size === 0 && editingId === null) return EMPTY_SELECTION;
      if (sameIds(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (state.editingId === action.id) return state;
      return { ids: state.ids, editingId: action.id };
    }
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Remotely deleted objects leave the selection; editing a deleted object ends.
  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);
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
