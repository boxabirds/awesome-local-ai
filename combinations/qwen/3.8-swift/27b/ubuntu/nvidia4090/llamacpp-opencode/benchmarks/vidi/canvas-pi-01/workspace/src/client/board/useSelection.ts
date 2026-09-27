// Multi-object selection state (see spec: sel.model, sel.keyboard).
//
// The selection is a set of object ids plus at most one id in edit mode.
// All transitions run through selectionReducer (pure, unit-tested); ids that
// no longer exist on the board are pruned whenever the snapshot changes
// (TC-15: a remote deletion empties the selection of that id).

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  /** The single object in text-edit mode (if any). */
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string }
  | { type: 'end-edit'; next: 'selected' | 'unselected' };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

/**
 * Pure selection transition function.
 * - click: the object becomes the whole selection (deselects the rest).
 * - toggle: adds/removes the object.
 * - setMany: additive union (marquee, select-all) or replacement.
 * - clear: empty (Escape, empty-space click, after delete).
 * - prune: drops ids no longer on the board; editingId pruned the same way.
 *   Returns the same state object when nothing changed (renders bail out).
 * - edit: enters edit mode for the object (keeps the selection).
 * - end-edit: leaves edit mode; next='selected' makes the object the whole
 *   selection (Escape), next='unselected' clears the selection (outside click).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: null };
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ids: next, editingId: null };
    }
    case 'setMany': {
      const next = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) next.add(id);
      return { ids: next, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : { ids: new Set(), editingId: null };
    case 'prune': {
      const kept = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) kept.add(id);
      }
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (kept.size === state.ids.size && editingId === state.editingId) return state;
      return { ids: kept, editingId };
    }
    case 'edit':
      return { ...state, editingId: action.id };
    case 'end-edit': {
      if (state.editingId === null) return state;
      const id = state.editingId;
      return action.next === 'selected'
        ? { ids: new Set([id]), editingId: null }
        : { ids: new Set(), editingId: null };
    }
  }
}

/**
 * Multi-object selection for the board. `snapshot` is the current board
 * content (recomputed on every doc change); ids are validated against it, and
 * removed objects are pruned.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]) {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const presentRef = useRef<ReadonlySet<string>>(new Set());
  presentRef.current = new Set(snapshot.map((o) => o.id));

  // Prune ids that disappeared (remote deletion, TC-15).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: new Set(snapshot.map((o) => o.id)) });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const valid = ids.filter((id) => presentRef.current.has(id));
    dispatch({ type: 'setMany', ids: valid, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  // No presence check: a just-created note is not in the snapshot until the
  // next render, and prune() clears a stale editingId if it ever is.
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'end-edit', next });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
