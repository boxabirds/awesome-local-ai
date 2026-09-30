import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Local, per-client selection. Never written to the board document. */
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
  /** Start (id) or end (null) text editing; ending keeps the object selected unless `keepSelected` is false. */
  | { type: 'edit'; id: string | null; keepSelected?: boolean };

export const EMPTY_SELECTION: SelectionState = Object.freeze({ ids: new Set<string>(), editingId: null });

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function withIds(state: SelectionState, ids: ReadonlySet<string>, editingId: string | null = null): SelectionState {
  if (sameSet(state.ids, ids) && state.editingId === editingId) return state;
  return { ids, editingId };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return withIds(state, new Set([action.id]));
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return withIds(state, ids);
    }
    case 'setMany': {
      const ids = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      return withIds(state, ids);
    }
    case 'clear':
      return withIds(state, new Set());
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      return withIds(state, ids, editingId);
    }
    case 'edit': {
      if (action.id !== null) return withIds(state, new Set([action.id]), action.id);
      if (state.editingId === null) return state;
      return withIds(state, action.keepSelected === false ? new Set() : new Set([state.editingId]));
    }
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * Multi-object selection over the current snapshot. Actions naming objects that
 * are not in the snapshot are ignored, and objects that disappear from it (for
 * example deleted by someone else) leave the selection; editing a removed object ends.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef(present);
  presentRef.current = present;

  useEffect(() => dispatch({ type: 'prune', presentIds: present }), [present]);

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);
  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);
  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids: ids.filter((id) => presentRef.current.has(id)), additive });
  }, []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  // Not checked against the snapshot: a note created a moment ago may not be in it yet.
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch({ type: 'edit', id: null, keepSelected: next === 'selected' });
  }, []);

  // Ids pruned by a snapshot change are hidden immediately, before the prune effect runs.
  const ids = useMemo(() => {
    for (const id of state.ids) if (!present.has(id)) return new Set([...state.ids].filter((i) => present.has(i)));
    return state.ids;
  }, [state.ids, present]);
  const editingId = state.editingId !== null && present.has(state.editingId) ? state.editingId : null;

  return useMemo(
    () => ({ ids, editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [ids, editingId, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
