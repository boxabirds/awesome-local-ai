import { useCallback, useEffect, useMemo, useReducer } from 'react';

/* ------------------------------------------------------------------ * *
 * Story 7: the selection is a set of objects, not one                   *
 * ------------------------------------------------------------------ */

/**
 * Per-client selection state. Never written to the document: which objects *you*
 * have selected, and which one you are typing in, belongs to this page — other
 * people select independently (story 3).
 *
 * `present` is what the board holds right now. Actions that name an id which is
 * not on the board are ignored, and a `prune` (run on every snapshot change)
 * drops ids somebody else deleted, so the selection never refers to an object
 * that is gone.
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  readonly present?: ReadonlySet<string>;
}

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

export type SelectionAction =
  /** A plain click: this one object, nothing else. */
  | { type: 'click'; id: string }
  /** Shift-click: add this object, or take it back out if it is already in. */
  | { type: 'toggle'; id: string }
  /** Marquee and select all: these objects, added to the selection or replacing it. */
  | { type: 'setMany'; ids: string[]; additive: boolean }
  /** Nothing selected, nothing being typed in. */
  | { type: 'clear' }
  /** Forget ids the board no longer has, and stop editing one that went away. */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Type in this object, or (with null) stop typing. */
  | { type: 'edit'; id: string | null };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The one rule applied in one place (design key decision 3): an action that
 * changes nothing returns the same state object, so React skips the re-render.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  const present = state.present;
  const onBoard = (id: string): boolean => present === undefined || present.has(id);
  // An editor that is no longer selected is no longer editing.
  const settled = (ids: ReadonlySet<string>): string | null =>
    state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;

  switch (action.type) {
    case 'click': {
      if (!onBoard(action.id)) return state;
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return { ...state, ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      if (!onBoard(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      if (sameIds(ids, state.ids)) return state;
      return { ...state, ids, editingId: settled(ids) };
    }
    case 'setMany': {
      const incoming = action.ids.filter(onBoard);
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of incoming) ids.add(id);
      if (sameIds(ids, state.ids)) return state;
      return { ...state, ids, editingId: settled(ids) };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ...state, ids: new Set<string>(), editingId: null };
    }
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId)
          ? state.editingId
          : null;
      const presentUnchanged =
        present !== undefined &&
        (present === action.presentIds || sameIds(present, action.presentIds));
      if (presentUnchanged && sameIds(ids, state.ids) && editingId === state.editingId) {
        return state;
      }
      return { ids, editingId, present: action.presentIds };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ...state, editingId: null };
      }
      // Not checked against `present`, unlike the actions above: the object most
      // often opened for typing is one this very action has just created, and
      // `present` is a render-time value that has not caught up with it. An id that
      // really is gone renders no editor, and `prune` forgets it a moment later.
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      // Typing in an object selects exactly that object (TC-21).
      return { ...state, ids: new Set([action.id]), editingId: action.id };
    }
  }
}

/** What a page can do to its own selection. */
export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  readonly count: number;
  isSelected(id: string): boolean;
  isEditing(id: string): boolean;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  stopEdit(): void;
}

/**
 * The page's selection, kept in sync with the board: `presentIds` (the ids in
 * the latest snapshot) prunes it, so a delete arriving from somebody else takes
 * the object out of the selection and leaves the rest alone.
 */
export function useSelection(presentIds: ReadonlySet<string>): Selection {
  const [state, dispatch] = useReducer(
    selectionReducer,
    presentIds,
    (present): SelectionState => ({ ids: new Set<string>(), editingId: null, present }),
  );

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const isSelected = useCallback((id: string) => state.ids.has(id), [state.ids]);
  const isEditing = useCallback((id: string) => state.editingId === id, [state.editingId]);

  return useMemo<Selection>(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      count: state.ids.size,
      isSelected,
      isEditing,
      click: (id) => dispatch({ type: 'click', id }),
      toggle: (id) => dispatch({ type: 'toggle', id }),
      setMany: (ids, additive) => dispatch({ type: 'setMany', ids, additive }),
      clear: () => dispatch({ type: 'clear' }),
      startEdit: (id) => dispatch({ type: 'edit', id }),
      stopEdit: () => dispatch({ type: 'edit', id: null }),
    }),
    [state.ids, state.editingId, isSelected, isEditing],
  );
}
