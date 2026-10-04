import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Where a note ends up when text editing stops. */
export type EditEnd = 'selected' | 'unselected';

/**
 * Which objects the local user has selected, and which one they are typing in.
 *
 * This is deliberately *not* stored in the Y.Doc: whose cursor is where, and what that person
 * has picked, belongs to this browser only. Writing it to the shared document would make every
 * click of every participant move somebody else's selection - the mistake story 3 makes
 * impossible by being the first story with more than one screen on a board.
 *
 * The selection is a *set*, not an id: story 7 lets one action pick up any number of objects,
 * and an operation on two of them has to be the same operation as on one.
 */
export interface SelectionState {
  /** The selected object ids. Insertion order is not meaningful; membership is. */
  readonly ids: ReadonlySet<string>;
  /** The one object this user is typing in, or `null`. */
  readonly editingId: string | null;
}

/** What the user asked the selection to do. Every action is one of these. */
export type SelectionAction =
  /** A press on one object: the selection becomes that object and nothing else. */
  | { readonly type: 'click'; readonly id: string }
  /** Shift + press: add the object, or take it back out if it was already in. */
  | { readonly type: 'toggle'; readonly id: string }
  /** A marquee or Ctrl/Cmd + A: many objects at once, additively or instead of. */
  | { readonly type: 'setMany'; readonly ids: readonly string[]; readonly additive: boolean }
  /** Empty board clicked, or Escape. */
  | { readonly type: 'clear' }
  /** The document no longer holds some of them: they leave the selection by themselves. */
  | { readonly type: 'prune'; readonly present: readonly string[] }
  | { readonly type: 'startEdit'; readonly id: string }
  | { readonly type: 'endEdit'; readonly next: EditEnd };

/** Nothing selected. The state a board starts in, and ends in after a delete. */
export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * The selection as a pure function of what it was and what the user did.
 *
 * `present`, when given, is the set of ids the board actually holds, and is the difference
 * between an action and a mistake: a press on an object that has just been deleted by somebody
 * else - which is exactly what a click racing a remote delete is - is ignored instead of
 * putting an id in the selection that nothing can draw an outline around.
 *
 * Two rules hold through every action: whatever is being typed into is either still selected or
 * not being typed into any more, and a toggle can take the selection down to nothing (Shift +
 * click on the last object left is how you get out of a selection you made).
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
  present?: Iterable<string> | null,
): SelectionState {
  const known = present === undefined || present === null ? null : new Set(present);
  const keeps = (id: string): boolean => known === null || known.has(id);
  /** The object being typed into, unless it has left the selection. */
  const keepEditing = (ids: ReadonlySet<string>): string | null =>
    state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;

  switch (action.type) {
    case 'click': {
      if (!keeps(action.id)) {
        return state;
      }
      const ids = new Set<string>([action.id]);
      return { ids, editingId: keepEditing(ids) };
    }
    case 'toggle': {
      if (!keeps(action.id)) {
        return state;
      }
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      return { ids, editingId: keepEditing(ids) };
    }
    case 'setMany': {
      const ids = new Set<string>(action.additive ? state.ids : []);
      for (const id of action.ids) {
        if (keeps(id)) {
          ids.add(id);
        }
      }
      return { ids, editingId: keepEditing(ids) };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : EMPTY_SELECTION;
    case 'prune': {
      const presentIds = new Set(action.present);
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (presentIds.has(id)) {
          ids.add(id);
        }
      }
      const editingId =
        state.editingId !== null && presentIds.has(state.editingId) ? state.editingId : null;
      return ids.size === state.ids.size && editingId === state.editingId
        ? state
        : { ids, editingId };
    }
    case 'startEdit': {
      if (!keeps(action.id)) {
        return state;
      }
      const ids = new Set(state.ids);
      ids.add(action.id);
      return { ids, editingId: action.id };
    }
    case 'endEdit':
      if (action.next === 'unselected') {
        return EMPTY_SELECTION;
      }
      return state.editingId === null ? state : { ids: state.ids, editingId: null };
  }
}

/** What `useSelection` gives the board: the selection, and the ways to change it. */
export interface MultiSelection extends SelectionState {
  /** How many objects are selected - what the selection bar says. */
  readonly size: number;
  /** The only object selected, or `null` when it is zero, or more than one. */
  readonly onlyId: string | null;
  /** A press on an object: select it alone. */
  click(id: string): void;
  /** Shift + press: add or remove one object. */
  toggle(id: string): void;
  /** Add (marquee) or replace (select all) many objects. */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Everything on the board. */
  selectAll(ids: readonly string[]): void;
  clear(): void;
  /** Start typing in one object, which selects it. */
  startEdit(id: string): void;
  /** Stop typing; Escape keeps the object selected, a click outside does not. */
  endEdit(next: EditEnd): void;
}

/** The ids an action talks about, whether or not they are on the board yet. */
function actionIds(action: SelectionAction): readonly string[] {
  switch (action.type) {
    case 'click':
    case 'toggle':
    case 'startEdit':
      return [action.id];
    case 'setMany':
      return action.ids;
    case 'clear':
    case 'endEdit':
    case 'prune':
      return [];
  }
}

/**
 * This browser's selection: a set of object ids, kept in step with the document.
 *
 * `objects` is the board's current snapshot. Two things come from it: an action naming an
 * object that is not in it is dropped, and whenever the snapshot changes the selection is
 * pruned - so when somebody else deletes three of the nine notes you had picked, six outlines
 * stay on the screen and the bar says six, without you doing anything.
 *
 * One thing is allowed through, because the board would be broken without it: an object an
 * action has just named is believed about for the moment between being made and appearing in
 * the snapshot. Double-clicking the board creates an object in the document and asks the
 * selection to edit it in the same breath, and the snapshot the person who wrote that line
 * expected - the one this hook was given - cannot contain an object made a millisecond ago.
 * So the new id is accepted, and the next snapshot either proves it exists or takes it away
 * again, which is the same rule as everything else here, arrived at from the other side.
 *
 * None of it is ever written to the document.
 */
export function useSelection(objects: readonly ObjectSnapshot[]): MultiSelection {
  // The ids the board holds in the snapshot this hook was last given.
  const present = useMemo(() => new Set(objects.map((object) => object.id)), [objects]);
  const presentRef = useRef(present);
  // Ids named by an action since the snapshot was last read: seen, but not yet counted.
  const namedRef = useRef(new Set<string>());
  useEffect(() => {
    presentRef.current = present;
  });

  const reducer = useCallback((state: SelectionState, action: SelectionAction): SelectionState => {
    const known = new Set(presentRef.current);
    for (const id of namedRef.current) {
      known.add(id);
    }
    return selectionReducer(state, action, known);
  }, []);
  const [state, dispatch] = useReducer(reducer, EMPTY_SELECTION);

  /** Ask for a change, and vouch for the ids named along the way until the board says otherwise. */
  const ask = useCallback(
    (action: SelectionAction): void => {
      for (const id of actionIds(action)) {
        namedRef.current.add(id);
      }
      dispatch(action);
    },
    [dispatch],
  );

  // Objects other people deleted leave this selection; editing an object that is gone ends.
  // Anything that was vouched for and never showed up is forgotten at the same moment.
  useEffect(() => {
    namedRef.current.clear();
    dispatch({ type: 'prune', present: [...present] });
  }, [present, dispatch]);

  const ids = state.ids;
  const api = useMemo(
    () => ({
      click: (id: string): void => {
        ask({ type: 'click', id });
      },
      toggle: (id: string): void => {
        ask({ type: 'toggle', id });
      },
      setMany: (next: readonly string[], additive: boolean): void => {
        ask({ type: 'setMany', ids: next, additive });
      },
      selectAll: (next: readonly string[]): void => {
        ask({ type: 'setMany', ids: next, additive: false });
      },
      clear: (): void => {
        dispatch({ type: 'clear' });
      },
      startEdit: (id: string): void => {
        ask({ type: 'startEdit', id });
      },
      endEdit: (next: EditEnd): void => {
        dispatch({ type: 'endEdit', next });
      },
    }),
    [ask, dispatch],
  );

  return {
    ids,
    editingId: state.editingId,
    size: ids.size,
    onlyId: ids.size === 1 ? ([...ids][0] ?? null) : null,
    ...api,
  };
}
