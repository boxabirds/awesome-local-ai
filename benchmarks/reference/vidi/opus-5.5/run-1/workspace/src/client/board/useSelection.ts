import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  ids: ReadonlySet<string>;
  /** The object whose text is being edited (always also the only selected object). */
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Returns `state` itself when nothing changes, so React skips re-rendering. */
function next(state: SelectionState, ids: ReadonlySet<string>, editingId: string | null): SelectionState {
  if (editingId === state.editingId && sameSet(ids, state.ids)) return state;
  return { ids, editingId };
}

/**
 * Pure selection logic. Click replaces the set; toggle adds or removes one id (Shift-click);
 * setMany selects several (marquee: additive; select all: replace); prune drops ids no longer
 * on the board (deleted by someone else) and ends editing of a pruned object; edit starts
 * (id) or ends (null) text editing.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return next(state, new Set([action.id]), state.editingId === action.id ? action.id : null);
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return next(state, ids, null);
    }
    case 'setMany': {
      const ids = new Set(action.additive ? [...state.ids, ...action.ids] : action.ids);
      return next(state, ids, null);
    }
    case 'clear':
      return next(state, new Set(), null);
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      return next(state, ids, editingId);
    }
    case 'edit':
      if (action.id === null) return next(state, state.ids, null);
      return next(state, new Set([action.id]), action.id);
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  /** Selects only this object and starts editing its text. */
  startEdit(id: string): void;
  /**
   * Selects only an object this viewer has just created (story 10), which the snapshot may not
   * show yet; if it is gone by the next snapshot, prune drops it.
   */
  adopt(id: string): void;
  /** Stops editing; the object stays selected, or with 'unselected' the selection is cleared. */
  endEdit(next?: EndEditNext): void;
}

/**
 * This viewer's selection (a set of object ids) and editing state. Local state only: it is
 * never written to the board document, so other people never see it (story 6 may add cues).
 * Actions naming ids that are not on the board are ignored; ids deleted by someone else leave
 * the selection as soon as the snapshot changes.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);
  const presentIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef(presentIds);
  presentRef.current = presentIds;

  // Before paint, so a remotely deleted object never shows a stale bar or handles.
  useLayoutEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);
  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);
  const setMany = useCallback((ids: string[], additive: boolean) => {
    const present = ids.filter((id) => presentRef.current.has(id));
    if (additive && present.length === 0) return;
    dispatch({ type: 'setMany', ids: present, additive });
  }, []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  // Not checked against the snapshot: a note just created is edited before the next render
  // shows it; if it is gone by then, prune ends the edit.
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const adopt = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const endEdit = useCallback((how: EndEditNext = 'selected') => {
    dispatch(how === 'selected' ? { type: 'edit', id: null } : { type: 'clear' });
  }, []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, adopt, endEdit }),
    [state, click, toggle, setMany, clear, startEdit, adopt, endEdit],
  );
}
