// Local selection + editing state (never stored in the Y.Doc).
// Story 7: selection is a set of object ids, not a single id.

import { useCallback, useEffect, useReducer, useRef } from 'react';
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

/**
 * Pure selection reducer (unit-tested in tests/unit/selection.test.ts).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Clicking the only selected object keeps state (no-op); clicking any
      // other object replaces the selection.
      if (state.ids.size === 1 && state.ids.has(action.id)) return state;
      return {
        ids: new Set([action.id]),
        editingId: action.id === state.editingId ? state.editingId : null,
      };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId =
        state.editingId !== null && action.id === state.editingId && !ids.has(action.id)
          ? null
          : state.editingId;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive
        ? new Set([...state.ids, ...action.ids])
        : new Set(action.ids);
      const editingId =
        state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
      return { ids, editingId };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null
        ? state
        : { ids: new Set(), editingId: null };
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId)
          ? state.editingId
          : null;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit':
      return {
        ids: action.id !== null ? new Set([action.id]) : state.ids,
        editingId: action.id,
      };
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Local multi-selection. Selection/editing state is pruned automatically
 * when objects disappear (e.g. deleted by someone else over sync).
 *
 * All id-based actions validate against the latest snapshot: actions on
 * unknown ids are ignored (stale-selection safety).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, { ids: EMPTY_SET, editingId: null });

  // Latest snapshot for validation (read inside callbacks, never a dep).
  const presentRef = useRef<ReadonlySet<string>>(EMPTY_SET);
  presentRef.current = new Set(snapshot.map((o) => o.id));

  const click = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const valid = ids.filter((id) => presentRef.current.has(id));
    dispatch({ type: 'setMany', ids: valid, additive });
  }, []);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'edit', id });
  }, []);

  /**
   * Start editing an object that was just created and is not in the rendered
   * snapshot yet (the dblclick-create path). Validation would reject it.
   */
  const startEditFresh = useCallback((id: string) => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  // Drop selection/edit state for objects that no longer exist.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: new Set(snapshot.map((o) => o.id)) });
  }, [snapshot]);

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    startEditFresh,
    endEdit,
  };
}

export type SelectionApi = ReturnType<typeof useSelection>;
