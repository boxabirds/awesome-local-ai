import { useReducer, useCallback, useEffect, useRef } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';

/**
 * Story 7: per-client multi-object selection (not persisted, never written
 * to the doc). The selection is a set of object ids plus the id currently
 * being edited.
 */

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

export const INITIAL_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Click replaces the whole selection with just this object.
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
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
      if (action.additive) {
        if (action.ids.length === 0) return state;
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      const next = new Set(action.ids);
      if (next.size === state.ids.size && [...next].every((id) => state.ids.has(id)) && state.editingId === null) {
        return state;
      }
      return { ids: next, editingId: null };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      // Objects deleted by other people leave the selection; editing a
      // pruned id ends.
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else changed = true;
      }
      const editingPruned = state.editingId !== null && !action.presentIds.has(state.editingId);
      if (!changed && !editingPruned) return state;
      return { ids: next, editingId: editingPruned ? null : state.editingId };
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
  click: (id: string) => void;
  toggle: (id: string) => void;
  setMany: (ids: string[], additive: boolean) => void;
  clear: () => void;
  startEdit: (id: string) => void;
  endEdit: (next: 'selected' | 'unselected') => void;
}

/**
 * Multi-selection bound to a live object snapshot. A snapshot change
 * dispatches `prune` so remotely deleted ids leave the selection.
 * Actions referring to ids absent from the snapshot are ignored.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, INITIAL_SELECTION);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const present = new Set<string>();
    for (const obj of snapshot) present.add(obj.id);
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const present = useCallback((id: string): boolean => {
    return snapshotRef.current.some((o) => o.id === id);
  }, []);

  const click = useCallback((id: string) => {
    if (!present(id)) return;
    dispatch({ type: 'click', id });
  }, [present]);

  const toggle = useCallback((id: string) => {
    if (!present(id)) return;
    dispatch({ type: 'toggle', id });
  }, [present]);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const presentIds = new Set<string>();
    for (const o of snapshotRef.current) presentIds.add(o.id);
    const filtered = ids.filter((id) => presentIds.has(id));
    dispatch({ type: 'setMany', ids: filtered, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string) => {
    if (!present(id)) return;
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, [present]);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
