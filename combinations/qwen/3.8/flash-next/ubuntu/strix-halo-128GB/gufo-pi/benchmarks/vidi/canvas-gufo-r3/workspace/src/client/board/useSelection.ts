import { useCallback, useEffect, useReducer } from 'react';
import { ObjectSnapshot } from '@shared/board-model';

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

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const newIds = new Set<string>([action.id]);
      return { ids: newIds, editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: null };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: null };
      }
      return { ids: new Set(action.ids), editingId: null };
    }
    case 'clear':
      return { ids: new Set<string>(), editingId: null };
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
      }
      // If nothing changed, return same state reference
      if (next.size === state.ids.size) {
        let same = true;
        for (const id of next) {
          if (!state.ids.has(id)) { same = false; break; }
        }
        if (same && editingId === state.editingId) return state;
      }
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        // End editing - keep selection
        return { ids: state.ids, editingId: null };
      }
      // Start editing: select just that id
      return { ids: new Set<string>([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** For backwards compat with story 2: returns the single selected id if exactly one is selected, otherwise null */
  selectedId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
  /** @deprecated use selection.ids with useEffect for pruning */
  prune(exists: (id: string) => boolean): void;
}

/**
 * Local, per-client selection and editing state.
 * Never written to the Y.Doc: other users must not see my selection as data.
 */
export function useSelection(snapshot?: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

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

  const endEdit = useCallback((next: EndEditNext) => {
    if (next === 'selected') {
      // Keep current selection, just end editing
      dispatch({ type: 'edit', id: null });
    } else {
      // Unselected: clear everything
      dispatch({ type: 'clear' });
    }
  }, []);

  const prune = useCallback((exists: (id: string) => boolean) => {
    // Legacy compatibility: build presentIds from the test
    // In the new system we use the snapshot-based prune directly
    // For compatibility, we need the current ids
    // This is handled by the snapshot effect below when snapshot is provided
    void exists; // no-op in new system; snapshot-based prune handles it
  }, []);

  // Auto-prune when snapshot changes
  useEffect(() => {
    if (!snapshot) return;
    const presentIds = new Set(snapshot.map((s) => s.id));
    dispatch({ type: 'prune', presentIds });
  }, [snapshot]);

  const selectedId = state.ids.size === 1 ? [...state.ids][0] : null;

  return {
    ids: state.ids,
    editingId: state.editingId,
    selectedId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
    prune,
  };
}
