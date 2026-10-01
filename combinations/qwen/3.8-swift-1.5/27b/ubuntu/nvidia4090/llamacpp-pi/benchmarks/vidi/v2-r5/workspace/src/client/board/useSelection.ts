// src/client/board/useSelection.ts
// Multi-selection state management (story 7).

import { useState, useCallback, useEffect } from 'react';
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
      const newIds = new Set(state.ids);
      if (newIds.has(action.id)) {
        newIds.delete(action.id);
      } else {
        newIds.add(action.id);
      }
      return { ids: newIds, editingId: null };
    }
    case 'setMany': {
      if (action.additive) {
        const newIds = new Set(state.ids);
        for (const id of action.ids) newIds.add(id);
        return { ids: newIds, editingId: null };
      } else {
        return { ids: new Set(action.ids), editingId: null };
      }
    }
    case 'clear': {
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const newIds = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) newIds.add(id);
      }
      const editingId = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids: newIds, editingId };
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

  // Prune selection when snapshot changes (remote deletes)
  useEffect(() => {
    const presentIds = new Set(snapshot.map(obj => obj.id));
    setState(prev => {
      // Only dispatch prune if something actually changed
      let needsPrune = false;
      for (const id of prev.ids) {
        if (!presentIds.has(id)) { needsPrune = true; break; }
      }
      if (prev.editingId && !presentIds.has(prev.editingId)) needsPrune = true;
      if (!needsPrune) return prev;
      return selectionReducer(prev, { type: 'prune', presentIds });
    });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    setState(prev => selectionReducer(prev, { type: 'click', id }));
  }, []);

  const toggle = useCallback((id: string) => {
    setState(prev => selectionReducer(prev, { type: 'toggle', id }));
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    setState(prev => selectionReducer(prev, { type: 'setMany', ids, additive }));
  }, []);

  const clear = useCallback(() => {
    setState(prev => selectionReducer(prev, { type: 'clear' }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState(prev => selectionReducer(prev, { type: 'edit', id }));
  }, []);

  const endEdit = useCallback(() => {
    setState(prev => selectionReducer(prev, { type: 'edit', id: null }));
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
