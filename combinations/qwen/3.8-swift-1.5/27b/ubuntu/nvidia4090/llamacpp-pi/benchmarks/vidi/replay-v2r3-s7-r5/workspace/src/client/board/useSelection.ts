import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Story 7: per-client multi-selection state. Pure reducer + hook; the
 * selection is never written to the Y.Doc — each client has its own.
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

/**
 * Pure selection reducer (sel.interaction):
 * - click replaces the set; toggle adds/removes; setMany (marquee/select all);
 * - clear empties; prune drops ids no longer on the board (remote delete);
 * - edit starts/ends text editing (editingId is always a subset of the set).
 * Actions are idempotent: returning the same state reference lets React skip
 * a re-render (important for the prune effect on every snapshot change).
 */
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
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      let editingId = state.editingId;
      if (editingId !== null && !next.has(editingId)) editingId = null;
      if (editingId !== null && editingId === action.id) editingId = null;
      if (setEquals(next, state.ids) && editingId === state.editingId) {
        // A toggle can never be a full no-op (it always changes membership),
        // but the check keeps the reducer honest if that ever changes.
        return state;
      }
      return { ids: next, editingId };
    }
    case 'setMany': {
      const next = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) next.add(id);
      const editingId = state.editingId !== null && next.has(state.editingId) ? state.editingId : null;
      if (
        action.additive &&
        next.size === state.ids.size &&
        editingId === state.editingId
      ) {
        return state; // all ids already selected
      }
      if (!action.additive && next.size === state.ids.size && editingId === state.editingId) {
        return state;
      }
      return { ids: next, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      let changed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else changed = true;
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
        changed = true;
      }
      if (!changed) return state;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === state.editingId) return state;
      if (action.id !== null && !state.ids.has(action.id)) {
        // Editing only ever applies to a selected object.
        return { ids: new Set([...state.ids, action.id]), editingId: action.id };
      }
      return { ids: state.ids, editingId: action.id };
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
  endEdit(): void;
}

function setEquals(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Local selection + editing state over the board snapshot. The snapshot drives
 * the prune effect: ids deleted by other people leave the selection, and
 * editing of a pruned id ends. Actions for ids absent from the snapshot are
 * ignored (the board is the source of truth).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  const presentRef = useRef<Set<string>>(new Set());
  presentRef.current = new Set(snapshot.map((o) => o.id));

  // Remote deletes (and any snapshot change) prune the selection.
  useEffect(() => {
    const present = new Set(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const present = presentRef.current;
    const valid = ids.filter((id) => present.has(id));
    if (valid.length === 0) return;
    dispatch({ type: 'setMany', ids: valid, additive });
  }, []);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => {
    // No presence guard: creating a note and editing it happen in the same
    // tick, before the snapshot re-renders. The prune effect ends editing of
    // ids that disappear.
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}

// Re-exported for callers that need set-comparison helpers.
export { setEquals };
