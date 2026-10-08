/**
 * Multi-selection state (story 7, sel.interaction).
 *
 * A pure `selectionReducer` plus the `useSelection(snapshot)` hook. The
 * selection never touches the Y.Doc — it is local UI state (contract:
 * "Selection state is never written to the Y.Doc").
 *
 * - `click`: replaces the set with {id} (also ends any editing).
 * - `toggle`: Shift-click add/remove.
 * - `setMany`: marquee / select-all. Additive unions with the current set;
 *   non-additive replaces it.
 * - `clear`: empty the set and end editing.
 * - `prune`: drop ids that disappeared from the document (remote deletes);
 *   editing a pruned id ends.
 * - `edit`: start/stop the editing id (does not change the selection set).
 */
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
      // Re-clicking the single selected object is a no-op (idempotent).
      if (state.editingId === null && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      const next = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) {
        next.add(id);
      }
      const same = next.size === state.ids.size && [...next].every((id) => state.ids.has(id));
      if (same && state.editingId === null) {
        return state;
      }
      return { ids: next, editingId: null };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) {
        return state;
      }
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          next.add(id);
        }
      }
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (next.size === state.ids.size && editingId === state.editingId) {
        return state;
      }
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === state.editingId) {
        return state;
      }
      return { ...state, editingId: action.id };
    }
    default:
      return state;
  }
}

const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * Multi-selection hook. `snapshot` is the current document snapshot; an
 * effect dispatches `prune` whenever it changes so ids deleted by others
 * leave the selection (and editing of a pruned id ends).
 *
 * `click`/`toggle` may reference ids that are not in the snapshot at call
 * time (e.g. the object was created in the same event); the prune effect
 * self-heals that on the next snapshot, so no guard is needed here.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  useEffect(() => {
    const present = new Set<string>();
    for (const obj of snapshot) {
      present.add(obj.id);
    }
    dispatch({ type: 'prune', presentIds: present });
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
