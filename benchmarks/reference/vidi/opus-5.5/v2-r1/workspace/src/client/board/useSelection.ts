import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Local selection and editing state. Never stored in the board document. */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Ids present on the board at the last `prune`; null = not known yet (accept any id). */
  readonly present: ReadonlySet<string> | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null }
  | { type: 'selectNew'; id: string };

const EMPTY: ReadonlySet<string> = new Set();

export const INITIAL_SELECTION: SelectionState = { ids: EMPTY, editingId: null, present: null };

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function withSelection(
  state: SelectionState,
  ids: ReadonlySet<string>,
  editingId: string | null,
): SelectionState {
  if (sameSet(ids, state.ids) && editingId === state.editingId) return state;
  return { ...state, ids: ids.size === 0 ? EMPTY : ids, editingId };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  const exists = (id: string) => state.present === null || state.present.has(id);
  switch (action.type) {
    case 'click':
      if (!exists(action.id)) return state;
      // Clicking the object being edited keeps editing it.
      return withSelection(
        state,
        new Set([action.id]),
        state.editingId === action.id ? action.id : null,
      );
    case 'toggle': {
      if (!exists(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return withSelection(state, ids, null);
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : EMPTY);
      for (const id of action.ids) if (exists(id)) ids.add(id);
      return withSelection(state, ids, null);
    }
    case 'clear':
      return withSelection(state, EMPTY, null);
    case 'prune': {
      const present = action.presentIds;
      const ids = new Set([...state.ids].filter((id) => present.has(id)));
      const editingId = state.editingId !== null && present.has(state.editingId) ? state.editingId : null;
      const next = withSelection(state, ids, editingId);
      // Moves change the snapshot but not which objects exist: keep the same state then.
      const samePresent = state.present !== null && sameSet(state.present, present);
      return next === state && samePresent ? state : { ...next, present };
    }
    case 'selectNew':
      // Like `edit`: a just-created object is not in the pruned snapshot yet.
      return withSelection(state, new Set([action.id]), null);
    case 'edit':
      if (action.id === null) return withSelection(state, state.ids, null);
      // Not checked against `present`: a note is edited right after it is created, before the
      // snapshot that contains it has been pruned against. A deleted id is pruned on the next change.
      return withSelection(state, new Set([action.id]), action.id);
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
  /** Selects only `id`, an object this tab has just created (story 10). */
  selectNew(id: string): void;
  /** Ends editing; the edited object stays selected unless `next` is 'unselected'. */
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * The set of selected objects and the one being edited. Objects that leave `snapshot` (deleted,
 * possibly by someone else) leave the selection; editing a deleted object ends.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, snapshot, (objects) => ({
    ...INITIAL_SELECTION,
    present: new Set(objects.map((o) => o.id)),
  }));

  const stateRef = useRef(state);
  stateRef.current = state;

  // Dispatch only when the prune changes something: most snapshot changes are edits of existing
  // objects, and a no-op dispatch per remote update makes React count a burst of updates (five
  // people typing) as an update loop.
  useEffect(() => {
    const action: SelectionAction = { type: 'prune', presentIds: new Set(snapshot.map((o) => o.id)) };
    if (selectionReducer(stateRef.current, action) !== stateRef.current) dispatch(action);
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const selectNew = useCallback((id: string) => dispatch({ type: 'selectNew', id }), []);
  const endEdit = useCallback(
    (next: 'selected' | 'unselected' = 'selected') =>
      dispatch(next === 'selected' ? { type: 'edit', id: null } : { type: 'clear' }),
    [],
  );

  return useMemo(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      click,
      toggle,
      setMany,
      clear,
      startEdit,
      selectNew,
      endEdit,
    }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, selectNew, endEdit],
  );
}
