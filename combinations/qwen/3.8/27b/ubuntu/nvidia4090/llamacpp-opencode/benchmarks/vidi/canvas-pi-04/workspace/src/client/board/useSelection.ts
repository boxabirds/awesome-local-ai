// Story 7: set-based selection state (anchor: sel.state).
//
// The selection is a set of object ids (not a single id). The reducer below is
// pure and fully unit-tested (TC-13..TC-15); the `useSelection` hook wraps it
// with `useReducer` and prunes ids that leave the snapshot (a note deleted
// remotely drops out of the selection). Editing is tracked separately: it is
// the id currently being text-edited and ends without clearing the selection.

import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string | null }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; liveIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const EMPTY: ReadonlySet<string> = new Set();

/** The pure selection reducer (unit-tested in tests/unit/selection.test.ts). */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Select only `id`, or clear when null.
      return { ...state, ids: action.id === null ? new Set() : new Set([action.id]) };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, ids: next };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ...state, ids: next };
      }
      return { ...state, ids: new Set(action.ids) };
    }
    case 'clear':
      return { ...state, ids: new Set() };
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) if (action.liveIds.has(id)) next.add(id);
      const editingId =
        state.editingId !== null && action.liveIds.has(state.editingId) ? state.editingId : null;
      // Bail out (same reference) when nothing was pruned, to avoid a re-render.
      if (next.size === state.ids.size && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'edit':
      return { ...state, editingId: action.id };
    default:
      return state;
  }
}

export interface SelectionApi {
  /** The ids currently selected. */
  ids: ReadonlySet<string>;
  /** The id being text-edited, if any. */
  editingId: string | null;
  /** Select only `id` (or clear when null). */
  click: (id: string | null) => void;
  /** Add or remove `id` (shift+click). */
  toggle: (id: string) => void;
  /** Set the selection to `ids`, adding to the current one when `additive`. */
  setMany: (ids: string[], additive: boolean) => void;
  /** Clear the selection. */
  clear: () => void;
  /** Begin editing `id` (selection is unchanged). */
  startEdit: (id: string) => void;
  /** Finish editing `id` (selection is unchanged). */
  endEdit: (id: string) => void;
}

const INITIAL: SelectionState = { ids: EMPTY, editingId: null };

/**
 * Set-based selection over the board snapshot. Prunes ids that are no longer
 * in the snapshot (a remote delete) and tracks the id being edited.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, INITIAL);

  // A note deleted remotely (or locally) drops out of the selection.
  useEffect(() => {
    const liveIds = new Set(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', liveIds });
  }, [snapshot]);

  const click = useCallback((id: string | null) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((_id: string) => dispatch({ type: 'edit', id: null }), []);

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
