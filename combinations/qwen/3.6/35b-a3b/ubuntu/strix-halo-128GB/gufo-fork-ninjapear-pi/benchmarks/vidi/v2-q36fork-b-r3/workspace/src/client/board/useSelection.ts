import { useReducer, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import type { ObjectSnap } from '@shared/board-model';

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
    case 'click':
      return { ids: new Set([action.id]), editingId: null };

    case 'toggle': {
      const has = state.ids.has(action.id);
      if (has) {
        // Remove but keep at least nothing — shift-click can clear all
        const next = new Set(state.ids);
        next.delete(action.id);
        return { ids: next, editingId: next.size === 0 ? null : state.editingId };
      }
      return { ids: new Set([...state.ids, action.id]), editingId: null };
    }

    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) {
          next.add(id);
        }
        return { ids: next, editingId: state.editingId };
      }
      return { ids: new Set(action.ids), editingId: null };
    }

    case 'clear':
      return { ids: new Set(), editingId: null };

    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          next.add(id);
        }
      }
      const editingSurvived = action.presentIds.has(state.editingId ?? '');
      return {
        ids: next,
        editingId: editingSurvived ? state.editingId : null,
      };
    }

    case 'edit':
      return { ...state, editingId: action.id };

    default:
      return state;
  }
}

export function useSelection(doc: Y.Doc, snapshot: readonly ObjectSnap[]) {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  // Prune on snapshot change — remotely deleted objects leave selection
  useEffect(() => {
    const present = new Set(snapshot.map((s) => s.id));
    // If editingId is not in the current snapshot, end editing
    if (state.editingId !== null && !present.has(state.editingId)) {
      dispatch({ type: 'edit', id: null });
    }
    // Only prune if something actually changed
    let needsPrune = false;
    for (const id of state.ids) {
      if (!present.has(id)) {
        needsPrune = true;
        break;
      }
    }
    if (needsPrune) {
      dispatch({ type: 'prune', presentIds: present });
    }
  }, [snapshot]); // snapshot reference changes on every doc update

  const click = useCallback(
    (id: string) => dispatch({ type: 'click', id }),
    [],
  );

  const toggle = useCallback(
    (id: string) => dispatch({ type: 'toggle', id }),
    [],
  );

  const setMany = useCallback(
    (ids: string[], additive: boolean) =>
      dispatch({ type: 'setMany', ids, additive }),
    [],
  );

  const clear = useCallback(
    () => dispatch({ type: 'clear' }),
    [],
  );

  const startEdit = useCallback(
    (id: string) => dispatch({ type: 'edit', id }),
    [],
  );

  const endEdit = useCallback(
    (_next: 'selected' | 'unselected') => dispatch({ type: 'edit', id: null }),
    [],
  );

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
