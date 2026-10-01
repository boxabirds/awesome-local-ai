import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

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

/** Pure reducer for selection state transitions. */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const next = new Set([action.id]);
      return { ids: next, editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // If the toggled-out id was being edited, stop editing
        return { ids: next, editingId: state.editingId === action.id ? null : state.editingId };
      }
      next.add(action.id);
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      const next = new Set(action.ids);
      return { ids: next, editingId: state.editingId && next.has(state.editingId) ? state.editingId : null };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingGone = state.editingId !== null && !action.presentIds.has(state.editingId);
      return { ids: next, editingId: editingGone ? null : state.editingId };
    }
    case 'edit': {
      return { ids: state.ids, editingId: action.id };
    }
  }
}

const initialState: SelectionState = { ids: new Set(), editingId: null };

export interface UseSelectionResult {
  /** Set of selected object ids. */
  ids: ReadonlySet<string>;
  /** Object whose text is being edited, or `null`. */
  editingId: string | null;
  /** Select only the given object (replaces selection). */
  click(id: string): void;
  /** Add or remove object from selection (Shift-click). */
  toggle(id: string): void;
  /** Set many objects (marquee, select-all). */
  setMany(ids: string[], additive: boolean): void;
  /** Clear all selection. */
  clear(): void;
  /** Start editing an object (implies selecting it). */
  startEdit(id: string): void;
  /** Stop editing; keep selection or clear it. */
  endEdit(next: EndEditNext): void;
  /** Legacy interface for story 2 compat: selectedId (single or null). */
  selectedId: string | null;
  /** Legacy select(id | null) for backwards compat. */
  select(id: string | null): void;
}

/**
 * Per-client multi-selection state with reducer. Never written to the Y.Doc.
 * Prunes ids that disappear from the snapshot (remote delete).
 */
export function useSelection(snapshot?: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  // Prune ids that no longer exist in the snapshot (remote delete)
  useEffect(() => {
    if (!snapshot) return;
    const presentIds = new Set(snapshot.map((obj) => obj.id));
    dispatch({ type: 'prune', presentIds });
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
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  // Legacy compat: selectedId is the first (only) id when selection has exactly one
  const selectedId = state.ids.size === 1 ? [...state.ids][0]! : null;

  const select = useCallback((id: string | null) => {
    if (id === null) {
      dispatch({ type: 'clear' });
    } else {
      dispatch({ type: 'click', id });
    }
  }, []);

  return useMemo(() => ({
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
    selectedId,
    select,
  }), [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit, selectedId, select]);
}
