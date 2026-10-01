import { useState, useCallback, useEffect, useRef } from 'react';
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
      return { ids: new Set([action.id]), editingId: null };
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
      } else {
        return { ids: new Set(action.ids), editingId: null };
      }
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingId = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids: next, editingId };
    }
    case 'edit': {
      return { ids: state.ids, editingId: action.id };
    }
  }
}

export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, setState] = useState<SelectionState>({ ids: new Set(), editingId: null });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Prune selection when the set of present ids changes (remote deletes)
  // Use a stable key derived from the ids to avoid infinite loops
  const idsKey = snapshot.map((o) => o.id).sort().join('\0');
  useEffect(() => {
    const presentIds = new Set(snapshotRef.current.map((o) => o.id));
    setState((prev) => {
      if (prev.ids.size === 0 && prev.editingId === null) return prev;
      const pruned = selectionReducer(prev, { type: 'prune', presentIds });
      // Only update if something actually changed
      if (pruned.ids.size === prev.ids.size && pruned.editingId === prev.editingId) {
        let same = true;
        for (const id of prev.ids) { if (!pruned.ids.has(id)) { same = false; break; } }
        if (same) return prev;
      }
      return pruned;
    });
  }, [idsKey]);

  const click = useCallback((id: string) => {
    setState((prev) => selectionReducer(prev, { type: 'click', id }));
  }, []);

  const toggle = useCallback((id: string) => {
    setState((prev) => selectionReducer(prev, { type: 'toggle', id }));
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    setState((prev) => selectionReducer(prev, { type: 'setMany', ids, additive }));
  }, []);

  const clear = useCallback(() => {
    setState((prev) => selectionReducer(prev, { type: 'clear' }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((prev) => {
      const next = selectionReducer(prev, { type: 'click', id });
      return { ...next, editingId: id };
    });
  }, []);

  const endEdit = useCallback(() => {
    setState((prev) => ({ ...prev, editingId: null }));
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
