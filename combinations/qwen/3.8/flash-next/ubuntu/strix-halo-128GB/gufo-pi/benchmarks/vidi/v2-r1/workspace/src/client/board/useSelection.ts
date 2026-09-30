import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';

/** Actions that mutate the selection state. */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

/** Pure reducer for selection state transitions. */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: null };

    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: next.has(state.editingId ?? '') ? state.editingId : null };
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
      return { ids: new Set(), editingId: null };

    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingStillPresent = state.editingId !== null && action.presentIds.has(state.editingId);
      return { ids: next, editingId: editingStillPresent ? state.editingId : null };
    }

    case 'edit':
      return { ids: state.ids, editingId: action.id };

    default:
      return state;
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Select a single object, replacing the whole selection. Ends editing. */
  click(id: string): void;
  /** Add or remove an object from the selection (Shift-click). */
  toggle(id: string): void;
  /** Set selection to a list of ids. If additive, adds to existing. */
  setMany(ids: string[], additive: boolean): void;
  /** Clear the selection entirely. */
  clear(): void;
  /** Start editing a specific object. */
  startEdit(id: string): void;
  /** End text editing. */
  endEdit(next: 'selected' | 'unselected'): void;
  /** Backward compat: select(id) like story 2. null clears. */
  select(id: string | null): void;
}

/**
 * Multi-object selection state.
 *
 * Both ids and editingId are local to this client and are deliberately *never*
 * written to the shared document.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  // Prune ids that no longer exist (remote deletes)
  useEffect(() => {
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
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    }
  }, []);

  const select = useCallback((id: string | null) => {
    if (id === null) dispatch({ type: 'clear' });
    else dispatch({ type: 'click', id });
  }, []);

  return useMemo(
    () => ({ ...state, click, toggle, setMany, clear, startEdit, endEdit, select }),
    [state, click, toggle, setMany, clear, startEdit, endEdit, select],
  );
}

/** True when keyboard focus is on something that takes text. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
}
