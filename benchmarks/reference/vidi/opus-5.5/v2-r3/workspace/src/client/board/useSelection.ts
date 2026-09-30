import { useCallback, useEffect, useMemo, useReducer } from 'react';
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

export const EMPTY_SELECTION: SelectionState = Object.freeze({ ids: new Set<string>(), editingId: null });

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function withIds(state: SelectionState, ids: ReadonlySet<string>, editingId: string | null): SelectionState {
  if (sameSet(state.ids, ids) && state.editingId === editingId) return state;
  return { ids, editingId };
}

/**
 * Pure selection logic (sel.interaction). `click` replaces the set, `toggle`
 * adds/removes one id, `setMany` replaces or extends it, `prune` drops ids no
 * longer on the board (ending an edit of a pruned id), `edit` starts
 * (`id`, selecting only it) or ends (`null`) text editing.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return withIds(state, new Set([action.id]), null);
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return withIds(state, ids, null);
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) ids.add(id);
      return withIds(state, ids, null);
    }
    case 'clear':
      return withIds(state, new Set(), null);
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      return withIds(state, ids, editingId);
    }
    case 'edit':
      if (action.id === null) return withIds(state, state.ids, null);
      return withIds(state, new Set([action.id]), action.id);
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

/**
 * Local multi-selection and editing state. Never written to the board document.
 * Ids absent from `snapshot` are never reported (so a selection can never refer
 * to a deleted object), and a snapshot change prunes them from the state.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  // Derived view: ids deleted since the last prune are already gone.
  const view = useMemo(() => selectionReducer(state, { type: 'prune', presentIds: present }), [state, present]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return useMemo(
    () => ({ ids: view.ids, editingId: view.editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [view, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
