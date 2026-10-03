/**
 * The board's selection (`sel.click`, `sel.shift_toggle`, `sel.all`, `sel.clear`,
 * `sel.remote_delete`) and, alongside it, which object is being text-edited.
 *
 * The board holds one selection, not one per object, and it is a set: shift-click,
 * the marquee and Ctrl+A all add to it, and dragging any member of it acts on all of
 * them. That is a small state machine with a lot of ways in, so it is a reducer —
 * `selectionReducer` is pure and testable on its own, and this hook is only plumbing:
 * the dispatchers the board's gestures and keys call, and the effect that keeps the
 * selection in step with the document.
 *
 * The reducer carries the ids the document had last time the board looked
 * (`presentIds`), which is what makes "an action about an object that is not here"
 * answerable without consulting the document: a click on an object that another
 * person has just deleted is ignored, rather than selecting something the board
 * cannot draw. `useSelection` feeds it the snapshot on every change, which is also
 * how an object deleted elsewhere drops out of this selection.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';

/** What is selected, and what is being typed into. */
export interface SelectionState {
  /** The selected ids. Order is not meaningful; size drives the selection bar. */
  readonly ids: ReadonlySet<string>;
  /** The object being text-edited, or null. It is always also selected. */
  readonly editingId: string | null;
  /**
   * The ids in the document as last seen: what a selection is allowed to hold.
   * Kept here rather than passed in per action so every action is checked the same
   * way, including the ones that arrive between two renders.
   */
  readonly presentIds: ReadonlySet<string>;
}

/** The ways the selection changes. One per gesture, plus the document's own. */
export type SelectionAction =
  /** A plain click or tap: this object, and nothing else. */
  | { type: 'click'; id: string }
  /** Shift-click: add it, or remove it if it was already in. */
  | { type: 'toggle'; id: string }
  /**
   * The marquee, and select-all: the given ids. `additive` keeps what is already
   * selected (the marquee adds to a selection), otherwise they replace it.
   */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  /** Escape, or a click on empty board space. */
  | { type: 'clear' }
  /** The document changed: drop whatever is no longer on the board. */
  | { type: 'prune'; presentIds: Iterable<string> }
  /** Enter or double-click on a selected object: edit its text, if it has any. */
  | { type: 'edit'; id: string | null }
  /**
   * This board has just created an object: it exists now, and it is the one selected.
   *
   * The one action that does not check `presentIds`, because it is what `presentIds`
   * is waiting for: a note made a moment ago is in the document but not yet in the
   * snapshot this state was built from, and a person who creates a note and starts
   * typing into it (`sticky.toolbar`'s TC-28) must not be told the note does not exist.
   */
  | { type: 'add'; id: string };

/** The empty selection, over an optional set of objects that exist. */
export function initialSelection(presentIds: Iterable<string> = []): SelectionState {
  return { ids: new Set(), editingId: null, presentIds: new Set(presentIds) };
}

/** Leave editing when the object being edited is no longer selected. */
function keepEditing(editingId: string | null, ids: ReadonlySet<string>): string | null {
  return editingId !== null && ids.has(editingId) ? editingId : null;
}

/** The pure selection state machine. Unknown or absent ids are ignored. */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!state.presentIds.has(action.id)) return state;
      const ids = new Set([action.id]);
      return { ...state, ids, editingId: keepEditing(state.editingId, ids) };
    }

    case 'toggle': {
      if (!state.presentIds.has(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ...state, ids, editingId: keepEditing(state.editingId, ids) };
    }

    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) {
        // Only objects that are actually on the board join a selection: this is the
        // same rule as above, applied to a list that came from the marquee or from
        // "select everything".
        if (state.presentIds.has(id)) ids.add(id);
      }
      return { ...state, ids, editingId: keepEditing(state.editingId, ids) };
    }

    case 'clear':
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ...state, ids: new Set(), editingId: null };

    case 'prune': {
      const presentIds = new Set(action.presentIds);
      const ids = new Set([...state.ids].filter((id) => presentIds.has(id)));
      const editingId = keepEditing(state.editingId, presentIds);
      const same =
        ids.size === state.ids.size &&
        editingId === state.editingId &&
        presentIds.size === state.presentIds.size &&
        [...presentIds].every((id) => state.presentIds.has(id));
      // Nothing changed: hand back the same state so the board does not re-render
      // every object on every document update.
      if (same) return state;
      return { ...state, ids, editingId, presentIds };
    }

    case 'add': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.presentIds.has(action.id)) {
        return state;
      }
      const presentIds = new Set(state.presentIds);
      presentIds.add(action.id);
      const ids = new Set([action.id]);
      return { ...state, presentIds, ids, editingId: keepEditing(state.editingId, ids) };
    }

    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        // Leaving the editor keeps the selection: Escape leaves a note selected
        // (`sticky.text`).
        return { ...state, editingId: null };
      }
      if (!state.presentIds.has(action.id)) return state;
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      // Starting to edit an object selects it on its own: you type into one thing
      // at a time, and its toolbar and outlines should point at the same note.
      return { ...state, ids: new Set([action.id]), editingId: action.id };
    }
  }
}

/** Everything the board's gestures, keys and components need to know and do. */
export interface SelectionHandle {
  /** The selected ids. */
  readonly ids: ReadonlySet<string>;
  /** The object being text-edited, or null. */
  readonly editingId: string | null;
  /** Is this object selected? Handy for the components that draw a whole board. */
  has(id: string): boolean;
  /** True when nothing is selected. */
  readonly empty: boolean;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  /** Select one object on its own — keyboard focus, long-press. */
  selectOnly(id: string): void;
  /** An object this board just made: it exists, and it is the selected one. */
  add(id: string): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * The board's selection, kept in step with `snapshot`.
 *
 * `snapshot` is what the board can actually draw — the objects whose type it knows —
 * which is what makes an object of an unknown type unselectable rather than invisible
 * but selected.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionHandle {
  const present = useMemo(() => new Set(snapshot.map((object) => object.id)), [snapshot]);
  const [state, dispatch] = useReducer(selectionReducer, present, initialSelection);

  // Objects deleted by somebody else leave the selection; the rest stay (`prune`).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const selectOnly = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const add = useCallback((id: string) => dispatch({ type: 'add', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);
  const has = useCallback((id: string) => state.ids.has(id), [state.ids]);

  return {
    ids: state.ids,
    editingId: state.editingId,
    has,
    empty: state.ids.size === 0,
    click,
    toggle,
    setMany,
    clear,
    selectOnly,
    add,
    startEdit,
    endEdit,
  };
}
