/**
 * Local selection and editing state (anchors: sel.interaction, sticky.interaction). Never
 * written to the Y.Doc: my selection is not board data that other people should receive.
 *
 * The selection is a set of object ids fed by clicks, Shift-clicks, the marquee and select
 * all. A snapshot change prunes ids of objects that no longer exist (deleted here or by
 * someone else); if the object being edited disappears, editing ends.
 */
import { useCallback, useLayoutEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Ids present in the last pruned snapshot; null until the first prune (nothing known yet). */
  present: ReadonlySet<string> | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null }
  | { type: 'created'; id: string };

const EMPTY: ReadonlySet<string> = new Set();

export const EMPTY_SELECTION: SelectionState = { ids: EMPTY, editingId: null, present: null };

function known(state: SelectionState, id: string): boolean {
  return state.present === null || state.present.has(id);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function withIds(state: SelectionState, ids: ReadonlySet<string>, editingId: string | null): SelectionState {
  const nextIds = sameSet(state.ids, ids) ? state.ids : ids;
  if (nextIds === state.ids && editingId === state.editingId) return state;
  return { ...state, ids: nextIds, editingId };
}

/** Pure selection transitions. Actions naming ids absent from the last snapshot are ignored. */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!known(state, action.id)) return state;
      // Clicking the object being edited keeps editing; anything else ends it.
      return withIds(state, new Set([action.id]), state.editingId === action.id ? action.id : null);
    }
    case 'toggle': {
      if (!known(state, action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return withIds(state, ids, null);
    }
    case 'setMany': {
      const incoming = action.ids.filter((id) => known(state, id));
      const ids = new Set(action.additive ? [...state.ids, ...incoming] : incoming);
      return withIds(state, ids, null);
    }
    case 'clear':
      return withIds(state, EMPTY, null);
    case 'prune': {
      const present = action.presentIds;
      const ids = new Set([...state.ids].filter((id) => present.has(id)));
      const editingId = state.editingId !== null && present.has(state.editingId) ? state.editingId : null;
      return { ...withIds(state, ids, editingId), present };
    }
    case 'created':
      // Like 'edit', a just-created object is not in the last snapshot yet; the next prune
      // drops it if it never appears.
      return withIds(state, new Set([action.id]), null);
    case 'edit': {
      // A just-created object may not be in the last snapshot yet, so editing is not checked;
      // the next prune ends it if the object never appears.
      if (action.id === null) return withIds(state, state.ids, null);
      return withIds(state, new Set([action.id]), action.id);
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
  /** Selects only an object this tab has just created (story 10 return to Select). */
  selectCreated(id: string): void;
  /** Ends editing; the object stays selected unless `next` is 'unselected'. */
  endEdit(next?: 'selected' | 'unselected'): void;
}

export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Layout effect: pruned before the browser paints, so a deleted object's bar or handles
  // never flash.
  useLayoutEffect(() => {
    dispatch({ type: 'prune', presentIds: new Set(snapshot.map((o) => o.id)) });
  }, [snapshot]);

  // Until the prune runs, never expose ids that are not in the rendered snapshot.
  const ids = useMemo(() => {
    if (state.ids.size === 0) return state.ids;
    const present = new Set(snapshot.map((o) => o.id));
    const kept = [...state.ids].filter((id) => present.has(id));
    return kept.length === state.ids.size ? state.ids : new Set(kept);
  }, [state.ids, snapshot]);
  const editingId = state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((list: string[], additive: boolean) => dispatch({ type: 'setMany', ids: list, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const selectCreated = useCallback((id: string) => dispatch({ type: 'created', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch(next === 'selected' ? { type: 'edit', id: null } : { type: 'clear' });
  }, []);

  return useMemo(
    () => ({ ids, editingId, click, toggle, setMany, clear, startEdit, selectCreated, endEdit }),
    [ids, editingId, click, toggle, setMany, clear, startEdit, selectCreated, endEdit],
  );
}
