/**
 * The selection: which objects the board holds, and which one is being edited.
 *
 * The selection is *local*: it is not in the shared document, and what one person has selected is
 * invisible to everybody else (and is gone when the tab is reloaded). It lives in one reducer so
 * that the rules of the PRD can be read as one list — a click selects one object, a shift-click
 * adds or removes one, *select all* takes every object, the marquee adds what it enclosed, an
 * object deleted by somebody else leaves the selection on its own — and so that those rules can
 * be tested without a board, a pointer or a browser.
 *
 * What the selection is *of* is a question for the registry: this file never asks what kind of
 * object an id belongs to. The board hands over the ids it has just read from the document, which
 * is why an object that no longer exists cannot be selected even by a stale marquee.
 */

import { useEffect, useMemo, useReducer } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';

/** The whole of the local selection state. */
export interface SelectionState {
  /** Selected object ids, in the order they were selected. */
  ids: ReadonlySet<string>;
  /** The one object whose editing surface is open, or null. */
  editingId: string | null;
}

export type SelectionAction =
  /** A plain click on an object: it is the selection, on its own. */
  | { type: 'click'; id: string }
  /** Shift-click: in the selection if it was not, out of it if it was. */
  | { type: 'toggle'; id: string }
  /**
   * The marquee (*additive*) or *select all* and *select none* (*exclusive*): the selection
   * becomes these ids, or grows by them.
   */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  /**
   * Which object's editing surface is open. An id opens it, and the object becomes the whole
   * selection: opening an object means working on that object. null closes it and leaves the
   * selection exactly as it was, which is what Escape does.
   */
  | { type: 'edit'; id: string | null }
  /**
   * Objects went away: drop them from the selection and close an editor they had open. The only
   * action that can empty the selection without anyone asking it to.
   */
  | { type: 'prune'; presentIds: ReadonlySet<string> };

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * The rules of the PRD, in one function.
 *
 * An action that changes nothing returns the state it was given, unchanged. That is not an
 * optimisation: the board dispatches a prune on every document update, and a selection that
 * "changed" into an identical set on each keystroke of a stranger would repaint the board and
 * move the resize handles under somebody's pointer.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // Pressing an object that is already in the selection keeps the whole selection, because
      // this is the press that drags a group: dropping the other nineteen is not what anybody
      // means by clicking one of them.
      if (state.ids.has(action.id)) return state;
      const ids = new Set<string>([action.id]);
      return { ids, editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: dropped(ids, state.editingId) };
    }
    case 'setMany': {
      if (action.additive) {
        // The marquee's rule: what it enclosed joins what was already selected, and a marquee
        // over thin air leaves the selection exactly as it was.
        if (action.ids.length === 0) return state;
        const ids = new Set(state.ids);
        for (const id of action.ids) ids.add(id);
        return { ids, editingId: state.editingId };
      }
      const ids = new Set<string>(action.ids);
      return { ids, editingId: dropped(ids, state.editingId) };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set<string>(), editingId: null };
    }
    case 'edit': {
      if (action.id === null) {
        // Closing the editor leaves the selection alone: Escape ends editing, it does not deselect.
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      // Opening an object's editing surface means it is the object at work, so it is in the
      // selection. The exclusive selection a double-click ends up with comes from the press that
      // preceded it, not from here: what this guarantees is only what the PRD asks — the object is
      // selected, and it is the one and only object open — while a group that a Shift-click grew
      // around the object being edited stays a group.
      if (state.editingId === action.id && state.ids.has(action.id)) return state;
      if (state.ids.has(action.id)) return { ids: state.ids, editingId: action.id };
      return { ids: new Set([...state.ids, action.id]), editingId: action.id };
    }
    case 'prune': {
      const missing = (id: string): boolean => !action.presentIds.has(id);
      const gone = [...state.ids].some(missing);
      const editorGone = state.editingId !== null && missing(state.editingId);
      if (!gone && !editorGone) return state;
      return {
        ids: new Set([...state.ids].filter((id) => !missing(id))),
        editingId: editorGone ? null : state.editingId,
      };
    }
  }
}

/** The editor closes when the object it was open on leaves the selection. */
const dropped = (ids: ReadonlySet<string>, editingId: string | null): string | null =>
  editingId !== null && !ids.has(editingId) ? null : editingId;

/** What the board knows about the selection. */
export interface Selection extends SelectionState {
  /** A plain click on an object. */
  click(id: string): void;
  /** Shift-click. */
  toggle(id: string): void;
  /** The marquee (additive) or select-all / select-none (exclusive). */
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  /** Opens an object's editing surface, and selects it. */
  startEdit(id: string): void;
  /** Closes it. The selection is what it was. */
  endEdit(): void;
}

/**
 * The selection as React state, plus the one thing a reducer cannot do for itself: noticing that
 * the board no longer contains an object that is in the selection.
 *
 * The board hands over the snapshot it is drawing, so the answer arrives with the same document
 * update that removed the object — no waiting for a second event, and no selection pointing at
 * an object that is not there, which is what a delete-while-dragged would otherwise leave behind.
 */
export function useSelection(objects: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const presentIds = useMemo(() => new Set(objects.map((object) => object.id)), [objects]);

  useEffect(() => {
    const missing = (id: string): boolean => !presentIds.has(id);
    const editorGone = state.editingId !== null && missing(state.editingId);
    if (![...state.ids].some(missing) && !editorGone) return;
    dispatch({ type: 'prune', presentIds });
  }, [presentIds, state]);

  return useMemo<Selection>(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      click: (id: string) => dispatch({ type: 'click', id }),
      toggle: (id: string) => dispatch({ type: 'toggle', id }),
      setMany: (ids: readonly string[], additive: boolean) =>
        dispatch({ type: 'setMany', ids, additive }),
      clear: () => dispatch({ type: 'clear' }),
      startEdit: (id: string) => dispatch({ type: 'edit', id }),
      endEdit: () => dispatch({ type: 'edit', id: null }),
    }),
    [state],
  );
}
