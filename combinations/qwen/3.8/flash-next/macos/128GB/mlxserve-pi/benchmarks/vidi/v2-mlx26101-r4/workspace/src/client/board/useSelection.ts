/**
 * Which objects are selected, and which one is being typed into.
 *
 * This is *local* state, deliberately never written to the `Y.Doc`: my selection is not
 * something anyone else should see, and it must not be synced by accident. What story 7
 * changed is that it is a *set* now — several objects selected at once, still one object
 * being typed into — and that the set is written through a reducer instead of a handful
 * of setters, because the number of ways a selection can change (click, shift+click,
 * marquee, select-all, Escape, a delete by a colleague) is larger than the number of
 * ways it can stay coherent.
 *
 * Two rules hold everywhere in this file:
 *
 * - An action that changes nothing returns the *same state object*, so React renders
 *   nothing. A document update that touched none of the selected objects must not
 *   re-render the board once per keystroke a colleague is typing.
 * - Nothing in here is ever written to the document. Objects leave the selection
 *   because they left the board (`prune`), never because this file decided to.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';

/** The whole of the local selection state. */
export interface SelectionState {
  /** Selected object ids. A set, because membership is the only question ever asked. */
  ids: ReadonlySet<string>;
  /**
   * The one object whose text is in front of the keyboard, or null. One rather than a
   * set: a keyboard can only be in one place, and an object with no text never appears
   * here at all.
   */
  editingId: string | null;
}

export type SelectionAction =
  /** One object is selected on its own; anything else the pointer was doing is forgotten. */
  | { type: 'click'; id: string }
  /** Shift+click: this object joins the selection, or leaves it if it was already in. */
  | { type: 'toggle'; id: string }
  /** A marquee, select-all, or a list of ids: added to the selection or replacing it. */
  | { type: 'setMany'; ids: string[]; additive: boolean }
  /** Empty board space clicked, or Escape: nothing is selected. */
  | { type: 'clear' }
  /** The board changed: ids that are no longer on it leave the selection. */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Typing starts in an object, or stops. Null stops; the selection is kept. */
  | { type: 'edit'; id: string | null };

const NO_IDS: ReadonlySet<string> = new Set<string>();

/** An empty selection: nothing chosen, nothing being typed into. */
export const EMPTY_SELECTION: SelectionState = Object.freeze({ ids: NO_IDS, editingId: null });

/** Where a note goes when editing stops: stay selected, or let go entirely.
 *
 * Kept for the sticky note's text editor, whose Escape means "stay selected" and whose
 * click-away means "let go" — the selection side of that is `clear`, the editing side is
 * here.
 */
export type EndEditTarget = 'selected' | 'unselected';

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The one place that decides what the selection is. Every way of changing it goes
 * through here, so the questions a reviewer needs answered — can a selection ever be
 * left holding an object that is gone? can two objects ever be typed into at once? can
 * an action empty the selection while leaving the caret in a note? — have one answer
 * each, in one file.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      // Clicking the object that is already the whole selection changes nothing, and
      // clicking the object being typed into keeps it open for typing.
      const editingId = state.editingId === action.id ? state.editingId : null;
      if (sameIds(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }

    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      // The object being typed in can only be in the typing by being in the selection, so taking it out
      // of the selection closes the typing with it. Taking any *other* object out leaves the caret
      // exactly where it was.
      const editingId = state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
      if (sameIds(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }

    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      const editingId = state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
      if (sameIds(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }

    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: NO_IDS, editingId: null };
    }

    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      // The common case by a wide margin: a document update that has nothing to do with
      // what this person selected. It must not cost a render.
      if (ids.size === state.ids.size && state.editingId === editingId) return state;
      return { ids, editingId };
    }

    case 'edit': {
      if (action.id === null) {
        // Escape from the text: typing stops, the objects stay where they were chosen.
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      // Opening a note for typing never takes anything *out* of the selection: with three notes chosen,
      // pressing Enter to type in one of them leaves the other two chosen, and a Delete pressed while
      // the typing is open still means the three of them. It does put the note being typed into the
      // selection if it is not in it — a note created a moment ago is not in the selection yet, and a
      // note that is not selected cannot be typed into as though it were.
      const ids = state.ids.has(action.id) ? state.ids : new Set<string>([...state.ids, action.id]);
      if (state.editingId === action.id && ids === state.ids) return state;
      return { ids, editingId: action.id };
    }
  }
}

export interface Selection {
  /** The selected object ids. Read-only: only an action changes it. */
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** The selected objects, in the order the board paints them. */
  selected: readonly ObjectSnapshot[];
  /** How many objects are selected, which is a question the UI asks constantly. */
  count: number;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  /** Open an object's text for typing, selecting it and only it. */
  startEdit(id: string): void;
  /** Stop typing. The selection is left exactly as it was. */
  endEdit(): void;
}

/**
 * The board's selection, kept up to date with what is actually on the board.
 *
 * The snapshot is an input, not a suggestion: whenever the document reports a different
 * set of objects, the selection is pruned to what survives, so a colleague deleting the
 * note you are typing in takes the caret away with it instead of leaving a box around
 * nothing. The pruning happens in an effect rather than during the render so that what
 * is drawn is always "the selection as of the objects I saw", never half-updated.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Which objects the board is holding as of this render. The snapshot is a step behind the document by
  // nature — it is read, then the document changes, then this component is told — so it is used to say
  // "this id is gone" and never to say "this id does not exist": a note created a moment ago is not in
  // the snapshot that is in hand yet, and refusing to open a brand new note for typing would break the
  // first thing anybody does on an empty board.
  const presentIds = useMemo(() => new Set(snapshot.map((object) => object.id)), [snapshot]);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string): void => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string): void => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: readonly string[], additive: boolean): void => {
    dispatch({ type: 'setMany', ids: [...ids], additive });
  }, []);

  const clear = useCallback((): void => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string): void => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((): void => {
    dispatch({ type: 'edit', id: null });
  }, []);

  const selected = useMemo(
    () => (state.ids.size === 0 ? [] : snapshot.filter((object) => state.ids.has(object.id))),
    [snapshot, state.ids],
  );

  // The caret is reported only while the object it belongs to is on the board. This is the same fact the
  // pruning effect keeps the *selection* to, but read rather than dispatched: a delete arriving from a
  // colleague takes the caret away on the render that noticed it, whoever pressed what a moment before.
  const editingId = state.editingId === null ? null : (presentIds.has(state.editingId) ? state.editingId : null);

  return {
    ids: state.ids,
    editingId,
    selected,
    count: state.ids.size,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
