// Local, per-client multi-selection + editing state (sel.interaction).
//
// A selection is NOT board data: it is never written to the Y.Doc, and other
// people never see it. The reducer is pure, so the whole state machine (click /
// shift-click / marquee / select-all / clear / remote-delete pruning) is unit
// testable without a DOM.
//
// `selectedId` and `select()` keep story 2's single-selection API working: they
// describe a selection of exactly one object (null for none or many).

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  /** Selected object ids (membership is all that matters, not order). */
  readonly ids: ReadonlySet<string>;
  /** The object whose text is being edited, if any. */
  readonly editingId: string | null;
}

export type SelectionAction =
  /** Make this object the only selection (a plain click). */
  | { type: 'click'; id: string }
  /** Add it, or remove it if it was already selected (Shift-click). */
  | { type: 'toggle'; id: string }
  /** Replace the selection, or union it in (marquee: additive). */
  | { type: 'setMany'; ids: string[]; additive: boolean }
  /** Nothing selected, nothing editing. */
  | { type: 'clear' }
  /** Drop ids that are no longer on the board (deleted by someone else). */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Start (or stop, with null) text editing. */
  | { type: 'edit'; id: string | null };

/** The Empty state of the selection state machine. */
export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Stop editing an object that is no longer part of the selection. */
function editingStillSelected(editingId: string | null, ids: ReadonlySet<string>): string | null {
  return editingId !== null && !ids.has(editingId) ? null : editingId;
}

/** The pure selection state machine (TC-13 to TC-15). Every action that would not
 * change anything returns the SAME state object, so React skips rendering and the
 * aria-live region does not re-announce. */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.editingId === null && state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = editingStillSelected(state.editingId, ids);
      if (editingId === state.editingId && sameIds(state.ids, ids)) return state;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      const editingId = editingStillSelected(state.editingId, ids);
      if (editingId === state.editingId && sameIds(state.ids, ids)) return state;
      return { ids, editingId };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId = state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ids: state.ids, editingId: null };
      }
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) return state;
      // Editing is a single-object affair, and it takes the selection with it.
      return { ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

/** The board's selection: the current set plus the actions every input path
 * (clicks, marquee, keys, gestures) drives it with. */
export interface SelectionApi extends SelectionState {
  /** The single selected id, or null when 0 or 2+ objects are selected. */
  selectedId: string | null;
  /** How many objects are selected. */
  count: number;
  /** A plain click: `id` becomes the only selection. */
  click(id: string): void;
  /** Shift-click: add `id`, or remove it if it was selected. */
  toggle(id: string): void;
  /** Replace the selection, or union `ids` into it (the marquee). */
  setMany(ids: string[], additive: boolean): void;
  /** Story 2's API: select one object, or clear with null. */
  select(id: string | null): void;
  clear(): void;
  startEdit(id: string): void;
  /** Stop editing. 'unselected' also clears the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * The board's selection state, kept in sync with the document: every snapshot
 * change prunes ids that are gone, so an object another person deleted drops out
 * of this selection while the rest stay selected (TC-15, sel.remote_delete).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[] = []): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Ids currently on the board. Actions naming an absent id are ignored: a click
  // can land on an object that was deleted a moment earlier.
  const liveIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef<ReadonlySet<string>>(liveIds);
  presentRef.current = liveIds;

  // Prune whenever the board changes (an effect, not a render side effect, so the
  // reducer runs outside the render phase).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: presentRef.current });
  }, [liveIds]);

  const click = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const known = ids.filter((id) => presentRef.current.has(id));
    // An empty ADDITIVE result (a marquee around nothing) leaves the selection
    // exactly as it was.
    if (additive && known.length === 0) return;
    dispatch({ type: 'setMany', ids: known, additive });
  }, []);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const select = useCallback((id: string | null) => {
    if (id === null) dispatch({ type: 'clear' });
    else if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);

  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    if (next === 'unselected') dispatch({ type: 'clear' });
    else dispatch({ type: 'edit', id: null });
  }, []);

  const selectedId = state.ids.size === 1 ? ([...state.ids][0] as string) : null;

  return {
    ids: state.ids,
    editingId: state.editingId,
    selectedId,
    count: state.ids.size,
    click,
    toggle,
    setMany,
    select,
    clear,
    startEdit,
    endEdit,
  };
}
