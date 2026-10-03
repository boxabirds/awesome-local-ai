/**
 * Local multi-selection + editing state (story 7).
 *
 * A per-client `ReadonlySet<string>` of selected object ids plus the id
 * being edited. Never written to the Y.Doc: remote deletes prune the set via
 * a snapshot effect (sel.remote_delete), and story 6 presence will publish
 * this set unchanged.
 */

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

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * Pure selection reducer.
 *
 * - `click` replaces the set (sel.click);
 * - `toggle` adds/removes one id (sel.shift_toggle);
 * - `setMany` adds (marquee) or replaces (select all);
 * - `clear` empties (sel.clear);
 * - `prune` drops ids no longer present (sel.remote_delete) and ends editing
 *   of a pruned id;
 * - `edit` starts/ends editing (a start also selects that single object).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return {
        ids: new Set([action.id]),
        editingId: state.editingId === action.id ? state.editingId : null,
      };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      const editingId = state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      return { ids: next, editingId };
    }
    case 'setMany': {
      const next = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      const editingId = state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      return { ids: next, editingId };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY;
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else changed = true;
      }
      const editingGone = state.editingId !== null && !action.presentIds.has(state.editingId);
      if (!changed && !editingGone) return state;
      return { ids: next, editingId: editingGone ? null : state.editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ...state, editingId: null };
      }
      return { ids: new Set([action.id]), editingId: action.id };
    }
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Select only this object (ignored when the id is not on the board). */
  click(id: string): void;
  /**
   * Select only this object without a presence check (tools.return_to_select:
   * a just-created object is not in the snapshot yet; the prune effect
   * cleans up ids that never appear).
   */
  select(id: string): void;
  /** Add or remove this object (Shift-click). */
  toggle(id: string): void;
  /** Add (additive) or replace with the given ids (marquee, select all). */
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * The per-client selection, pruned against the live snapshot so objects
 * deleted by other people leave the selection (sel.remote_delete).
 * Actions referring to ids absent from the snapshot are ignored.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY);

  const presentIds = useMemo(
    () => new Set(snapshot.map((o) => o.id)),
    [snapshot],
  );

  // Remote deletes (and any snapshot change) prune the selection.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'click', id });
    },
    [presentIds],
  );

  const toggle = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'toggle', id });
    },
    [presentIds],
  );

  const setMany = useCallback(
    (ids: string[], additive: boolean) => {
      const present = ids.filter((id) => presentIds.has(id));
      dispatch({ type: 'setMany', ids: present, additive });
    },
    [presentIds],
  );

  const select = useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  // No presence guard: a just-created object is not in the snapshot yet
  // (dblclick create + edit in one tick). The prune effect cleans up ids
  // that never appear.
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, select, toggle, setMany, clear, startEdit, endEdit };
}
