// Per-client selection state (story 2's single id, story 7's set).
//
// Selection is *never* written to the Y.Doc: another person's selection is not
// data, and presence of cursors/selections is a later story's job. What is
// stored is only this client's answer to "which objects of the ones I can see do
// I have picked, and am I editing one of them".
//
// The reducer is pure and exported so the rules are unit-testable without React.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model.ts';

/** What ending an edit should leave behind: the object stays selected or not. */
export type EndNext = 'selected' | 'unselected';

export interface SelectionState {
  /** The selected object ids, in the order they were added. */
  readonly ids: ReadonlySet<string>;
  /** The object being text-edited, or null. At most one, and always selected. */
  readonly editingId: string | null;
  /**
   * The ids known to exist, as of the last `prune` — null until the first
   * snapshot arrives. Actions naming an id outside it are ignored, so a stale
   * click cannot resurrect an object someone else deleted.
   */
  readonly presentIds: ReadonlySet<string> | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

/** The state an empty board starts in. */
export const EMPTY_SELECTION: SelectionState = {
  ids: new Set<string>(),
  editingId: null,
  presentIds: null,
};

function withIds(state: SelectionState, ids: ReadonlySet<string>): SelectionState {
  return { ...state, ids, editingId: null };
}

/** True when `id` may be put into the selection at all (unknown ids are ignored). */
function known(state: SelectionState, id: string): boolean {
  return state.presentIds === null || state.presentIds.has(id);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The selection rules:
 *  - `click` replaces the selection with the one object (and leaves editing);
 *  - `toggle` (Shift-click) adds or removes one object, leaving the others alone;
 *  - `setMany` is the marquee (additive) and Ctrl/Cmd+A (a fresh set);
 *  - `clear` is Escape, an empty-space click and the last object being toggled off;
 *  - `prune` drops ids that no longer exist, ending the edit of a pruned object;
 *  - `edit` starts (or ends) text editing of one object, selecting it first.
 *
 * A state that would not change is returned unchanged, so an unchanged snapshot
 * never re-renders the board.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!known(state, action.id)) return state;
      const next = new Set([action.id]);
      return sameIds(state.ids, next) && state.editingId === null
        ? state
        : withIds(state, next);
    }
    case 'toggle': {
      if (!known(state, action.id)) return state;
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return withIds(state, next);
    }
    case 'setMany': {
      const picked = action.ids.filter((id) => known(state, id));
      const next = action.additive ? new Set([...state.ids, ...picked]) : new Set(picked);
      return sameIds(state.ids, next) && state.editingId === null
        ? state
        : withIds(state, next);
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null
        ? state
        : { ...state, ids: new Set<string>(), editingId: null };
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId != null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (sameIds(state.ids, ids) && editingId === state.editingId) return state;
      return { ids, editingId, presentIds: action.presentIds };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ...state, editingId: null };
      }
      // The object being typed into is the selection. Typing into one note of a
      // group narrows the selection to it, so the keys that follow a click into the
      // text — Escape, Delete — act on that one object and not on the group.
      const sole = state.ids.size === 1 && state.ids.has(action.id);
      const ids = sole ? state.ids : new Set([action.id]);
      if (state.editingId === action.id && ids === state.ids) return state;
      return { ...state, ids, editingId: action.id };
    }
    default:
      return state;
  }
}

export interface Selection {
  /** The selected object ids. */
  readonly ids: ReadonlySet<string>;
  /** The object being text-edited, or null. */
  readonly editingId: string | null;
  /** Click without Shift: this object is the whole selection. */
  click(id: string): void;
  /** Shift-click: add, or remove if already selected. */
  toggle(id: string): void;
  /** The marquee (additive) and select-all (a fresh set). */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Escape / empty-space click: nothing is selected. */
  clear(): void;
  /** Select and start text-editing one object. */
  startEdit(id: string): void;
  /** Stop editing; `unselected` also drops the selection (story 2's rule). */
  endEdit(next?: EndNext): void;
}

/**
 * Local selection and editing state, kept in sync with the document by pruning:
 * when other people delete objects I have selected, those ids drop out of my
 * selection and the rest stay (sel.interaction). Editing is always of an object
 * that is also selected.
 *
 * `snapshot` is the current list of objects in the document.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // The ids that exist *right now*, read through a ref so the action creators
  // registered once never act on a stale list.
  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef(present);
  presentRef.current = present;

  // Remote deletes (and creates) reach the selection here.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: presentRef.current });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(
    (next?: EndNext) => {
      dispatch({ type: 'edit', id: null });
      if (next === 'unselected') dispatch({ type: 'clear' });
    },
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
      endEdit,
    }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
