import { useCallback, useLayoutEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Ids of the objects on the board at the last prune; click/toggle/setMany ignore any other id. */
  present: ReadonlySet<string>;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'selectNew'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const EMPTY: ReadonlySet<string> = new Set();

export function initialSelection(present: ReadonlySet<string> = EMPTY): SelectionState {
  return { ids: EMPTY, editingId: null, present };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function withIds(state: SelectionState, ids: ReadonlySet<string>): SelectionState {
  // Any change of selection other than to the edited note alone ends editing.
  const editingId = state.editingId !== null && ids.size === 1 && ids.has(state.editingId) ? state.editingId : null;
  if (sameSet(ids, state.ids) && editingId === state.editingId) return state;
  return { ...state, ids: sameSet(ids, state.ids) ? state.ids : ids, editingId };
}

/**
 * This client's selection. Pure: `click` replaces the selection, `toggle` adds or removes one id (Shift-click),
 * `setMany` selects many (marquee, select all), `prune` drops ids that left the board, `edit` starts or ends text
 * editing. Ids that are not on the board are ignored (except `edit`, which may name a note created a moment ago).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      if (!state.present.has(action.id)) return state;
      return withIds(state, new Set([action.id]));
    case 'selectNew':
      // An object this client has just created: it may not be in `present` until the next prune.
      return withIds(state, new Set([action.id]));
    case 'toggle': {
      if (!state.present.has(action.id)) return state;
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return withIds(state, next);
    }
    case 'setMany': {
      const ids = action.ids.filter((id) => state.present.has(id));
      if (action.additive && ids.length === 0) return state;
      return withIds(state, new Set(action.additive ? [...state.ids, ...ids] : ids));
    }
    case 'clear':
      return withIds(state, EMPTY);
    case 'prune': {
      const present = action.presentIds;
      const kept = [...state.ids].filter((id) => present.has(id));
      const ids = kept.length === state.ids.size ? state.ids : new Set(kept);
      const editingId = state.editingId !== null && present.has(state.editingId) ? state.editingId : null;
      if (ids === state.ids && editingId === state.editingId && present === state.present) return state;
      return { ids, editingId, present };
    }
    case 'edit':
      if (action.id === null) return state.editingId === null ? state : { ...state, editingId: null };
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ...state, ids: new Set([action.id]), editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  /** Selects only `id`, an object this client has just created (story 10 tools). */
  selectNew(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  /** Ends editing; `'unselected'` (a press elsewhere) also clears the selection. */
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * This client's selection and text-editing state, kept in step with the board: objects deleted (by anyone)
 * leave the selection, and editing of a deleted note ends. Deliberately local: never written to the Y.Doc,
 * so other people never see my selection.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const presentIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const [state, dispatch] = useReducer(selectionReducer, presentIds, initialSelection);

  useLayoutEffect(() => dispatch({ type: 'prune', presentIds }), [presentIds]);

  // Until the prune above has run, hide ids that have already left the board.
  const ids = useMemo(() => {
    const kept = [...state.ids].filter((id) => presentIds.has(id));
    return kept.length === state.ids.size ? state.ids : new Set(kept);
  }, [state.ids, presentIds]);
  const editingId = state.editingId !== null && presentIds.has(state.editingId) ? state.editingId : null;

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const selectNew = useCallback((id: string) => dispatch({ type: 'selectNew', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback((list: string[], additive: boolean) => dispatch({ type: 'setMany', ids: list, additive }), []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return useMemo(
    () => ({ ids, editingId, click, selectNew, toggle, setMany, clear, startEdit, endEdit }),
    [ids, editingId, click, selectNew, toggle, setMany, clear, startEdit, endEdit],
  );
}
