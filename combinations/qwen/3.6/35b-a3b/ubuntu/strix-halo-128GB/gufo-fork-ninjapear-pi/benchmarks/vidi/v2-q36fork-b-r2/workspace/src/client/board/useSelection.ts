import * as React from 'react';
import * as Y from 'yjs';

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  prune(presentIds: ReadonlySet<string>): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

interface InternalState {
  ids: Set<string>;
  editingId: string | null;
}

/** Pure reducer for selection state (exported for testing). */
export function selectionReducer(state: InternalState, action: SelectionAction): InternalState {
  switch (action.type) {
    case 'click':
      return { ...state, ids: new Set([action.id]), editingId: null };
    
    case 'toggle': {
      const newIds = new Set(state.ids);
      if (newIds.has(action.id)) {
        newIds.delete(action.id);
      } else {
        newIds.add(action.id);
      }
      return { ...state, ids: newIds };
    }
    
    case 'setMany': {
      if (action.additive) {
        return { ...state, ids: new Set([...state.ids, ...action.ids]) };
      } else {
        return { ...state, ids: new Set(action.ids) };
      }
    }
    
    case 'clear':
      return { ids: new Set(), editingId: null };
    
    case 'prune': {
      // Remove ids that are no longer in the snapshot
      const prunedIds = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) {
          prunedIds.add(id);
        }
      }
      const newEditingId = state.editingId !== null && !action.presentIds.has(state.editingId)
        ? null
        : state.editingId;
      return { ...state, ids: prunedIds, editingId: newEditingId };
    }
    
    case 'edit':
      return { ...state, editingId: action.id };
  }
}

export function useSelection(snapshot: readonly { id: string }[] = [], doc?: Y.Doc): SelectionState {
  const [state, dispatch] = React.useReducer(selectionReducer, { ids: new Set<string>(), editingId: null });

  // Watch for remote deletions via yjs deep observation
  React.useEffect(() => {
    if (!doc) return;
    const objects = doc.getMap('objects');
    
    const handler = () => {
      const currentIds = new Set(state.ids);
      const currentEditingId = state.editingId;
      
      const present = new Set<string>();
      objects.forEach((v, k) => present.add(k));
      
      // Prune removed IDs
      const pruned = new Set<string>();
      for (const id of currentIds) {
        if (present.has(id)) pruned.add(id);
      }
      const newEditingId = currentEditingId !== null && !present.has(currentEditingId)
        ? null
        : currentEditingId;
      
      if (pruned.size !== currentIds.size || newEditingId !== currentEditingId) {
        dispatch({ type: 'prune', presentIds: present });
      }
    };

    objects.observeDeep(handler);
    return () => {
      objects.unobserveDeep(handler);
    };
  }, [doc]);

  // Re-prune based on snapshot changes (for component render path)
  const prevSnapshotRef = React.useRef<string[]>([]);
  const currentIdsArr = snapshot.map(s => s.id);
  
  React.useEffect(() => {
    const prevSet = new Set(prevSnapshotRef.current);
    const currSet = new Set(currentIdsArr);
    
    // Check if anything was deleted
    let hasDeleted = false;
    for (const id of state.ids) {
      if (!currSet.has(id)) {
        hasDeleted = true;
        break;
      }
    }
    
    if (hasDeleted) {
      dispatch({ type: 'prune', presentIds: currSet });
    }
    prevSnapshotRef.current = currentIdsArr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, state.ids]);

  const click = React.useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = React.useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = React.useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = React.useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const prune = React.useCallback((presentIds: ReadonlySet<string>) => {
    dispatch({ type: 'prune', presentIds });
  }, []);

  const startEdit = React.useCallback((id: string) => {
    dispatch({ type: 'edit', id });
    // Also select this id
    dispatch({ type: 'click', id });
  }, []);

  const endEdit = React.useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    }
  }, []);

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    prune,
    startEdit,
    endEdit,
  };
}
