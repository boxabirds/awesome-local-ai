import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Immutable selection state. */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

/** Actions the selection reducer handles. */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const INITIAL: SelectionState = { ids: new Set(), editingId: null };

/**
 * Pure reducer for selection state. Used by useSelection hook.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const next = new Set<string>();
      if (action.id) next.add(action.id);
      return { ids: next, editingId: state.editingId && action.id === state.editingId ? state.editingId : null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      const editing = state.editingId && next.has(state.editingId) ? state.editingId : null;
      return { ids: next, editingId: editing };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      return { ids: new Set(action.ids), editingId: null };
    }
    case 'clear':
      return INITIAL;
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editing = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids: next, editingId: editing };
    }
    case 'edit': {
      if (action.id === null) {
        return { ids: state.ids, editingId: null };
      }
      // Start editing: ensure the id is selected
      const ids = state.ids.has(action.id) ? state.ids : new Set([...state.ids, action.id]);
      return { ids, editingId: action.id };
    }
    default:
      return state;
  }
}

/** The public interface returned by useSelection. */
export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * Multi-selection hook (per client, not persisted). Prunes ids that leave the
 * snapshot (remote deletes), so the selection never refers to dead objects.
 */
export function useSelection(snapshot?: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, INITIAL);

  // Prune when snapshot changes: remove ids no longer in the doc
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!snapshot) return;
    const presentIds = new Set(snapshot.map((o) => o.id));
    // Only dispatch if something is actually missing (avoid pointless re-renders)
    let needsPrune = false;
    for (const id of state.ids) {
      if (!presentIds.has(id)) { needsPrune = true; break; }
    }
    if (!needsPrune && state.editingId && !presentIds.has(state.editingId)) {
      needsPrune = true;
    }
    if (needsPrune) {
      dispatch({ type: 'prune', presentIds });
    }
  }, [snapshot, state.ids, state.editingId]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
