import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model.js';

/**
 * Which objects this client has selected, and which one it is typing into.
 *
 * Story 7 turned this from a single id into a **set** (`sel.click`,
 * `sel.shift_toggle`, `sel.marquee`, `sel.all`), but the rule that made story 2
 * write it as local state is stronger than ever: what one person has selected is
 * not board content, and once the document is shared (story 3) writing it into
 * the Y.Doc would move other people's selection. So it is a `ReadonlySet<string>`
 * in React state, never in the document.
 *
 * The reducer is exported separately so its rules - a click replaces the set, a
 * toggle adds or removes, a prune drops ids other people deleted - are testable
 * without rendering anything.
 */

/** Everything the selection can be asked to do. */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

/** The selection's shape: the selected ids, plus the id being edited. */
export interface SelectionState {
  /** The selected object ids. A set, so membership is a lookup and order is not. */
  ids: ReadonlySet<string>;
  /** The object whose text editor is open, if any. Always one of `ids`. */
  editingId: string | null;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

/** A new set holding exactly `ids`. */
const toSet = (ids: readonly string[]): Set<string> => new Set(ids);

/**
 * The pure selection state machine. Actions are described in the story's design;
 * the load-bearing details:
 * - `click` **replaces** the selection with just that id (but keeps the editor
 *   open if you click the note you are already typing into);
 * - `toggle` adds an id, or removes it if it is already there - and removing the
 *   last one leaves an empty selection (TC-14);
 * - `setMany` is the marquee (additive: the swept ids join what is already
 *   selected) and select-all (non-additive: the set becomes these ids);
 * - `prune` drops ids that are no longer in the document, and closes the editor
 *   if the note being edited is the one that went away (TC-15, `sel.remote_delete`).
 *
 * Whenever an action would not change anything, the *same* state object is
 * returned, so React does not re-render on a document change that does not touch
 * the selection (e.g. someone else typing in a note nobody selected).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const editingGone = state.editingId !== null && state.editingId !== action.id;
      const ids = new Set<string>([action.id]);
      const editingId = editingGone ? null : state.editingId;
      if (sameSet(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId;
      if (sameSet(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }
    case 'setMany': {
      const next = action.additive ? new Set([...state.ids, ...action.ids]) : toSet(action.ids);
      const editingId = state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      if (sameSet(state.ids, next) && state.editingId === editingId) return state;
      return { ids: next, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: EMPTY, editingId: null };
    }
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (sameSet(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      // Opening an editor is a single-object action (double-click, Enter, the
      // toolbar pencil, or a freshly created note), so it collapses the selection
      // to just that object - matching "this is the one I'm working on". Ending
      // an edit (id null) leaves the rest of the selection alone.
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      return { ids: new Set<string>([action.id]), editingId: action.id };
    }
  }
}

/** What `useSelection` hands the rest of the board. */
export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Replace the selection with just this object (`sel.click`). */
  click(id: string): void;
  /** Add or remove this object without disturbing the rest (Shift-click). */
  toggle(id: string): void;
  /** Select many at once - the marquee (additive) or select-all (replace). */
  setMany(ids: string[], additive: boolean): void;
  /** Select nothing (`sel.clear`). */
  clear(): void;
  /** Open one object's text editor (implies selecting it). */
  startEdit(id: string): void;
  /** Close the text editor, keeping the selection. */
  endEdit(): void;
}

/**
 * The per-client selection. `snapshot` is the current board snapshot; a change to
 * it dispatches `prune`, so ids other people deleted leave this selection on
 * their own (TC-16, and the e2e "colleague deletes one of my selected notes").
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, { ids: EMPTY, editingId: null });

  // A document change can delete what we have selected; keep the selection a
  // subset of what actually exists. Rebuilt from the snapshot on every change.
  // The selection is local; the document is shared. Keep the set honest about what
  // still exists - an object another person deleted must leave this selection -
  // without disturbing it otherwise.
  //
  // Crucially this only dispatches when there is something to drop. Dispatching on
  // *every* snapshot change would schedule an update on every keystroke typed into
  // a note (each keystroke is a document change); even when the reducer returns the
  // same state, React then cannot settle its nested-update count while a burst of
  // input is arriving, and it bails out with "maximum update depth exceeded". A
  // board being typed into has, almost always, nothing to prune - so do nothing.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const { ids, editingId } = stateRef.current;
    if (ids.size === 0 && editingId === null) return;
    const present = new Set(snapshot.map((object) => object.id));
    let stale = editingId !== null && !present.has(editingId);
    if (!stale) {
      for (const id of ids) {
        if (!present.has(id)) {
          stale = true;
          break;
        }
      }
    }
    if (!stale) return;
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return useMemo<UseSelectionResult>(
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
