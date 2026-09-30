// Selection state (`sel.interaction`).
//
// Story 2's selection was one id. Story 7 made it a set, because a click, a
// shift-click, a marquee and select-all are four ways of writing the same thing,
// and the interesting cases are all about the set: shift-clicking a member takes it
// out; an object somebody else deletes has to leave on its own (TC-15); the note
// being edited has to stop being edited when it goes.
//
// The reducer is pure and exported on its own, so those rules are testable without a
// screen. The hook owns nothing but local state: selection is never written to the
// shared document — what other people see is the selection bar, not the selection.
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { BoardObject } from '../../shared/board-model';

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  /** The object whose text editor is open, if any. */
  readonly editingId: string | null;
}

/** Nothing selected, nothing editing. Also the state a prune empties back into. */
export const emptySelection: SelectionState = { ids: new Set<string>(), editingId: null };

export type SelectionAction =
  /** A plain press on an object: it becomes the whole selection. */
  | { type: 'click'; id: string }
  /** Shift-click: in or out, one member at a time. */
  | { type: 'toggle'; id: string }
  /** Marquee (additive) and select-all (a replacement). */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  /** Drop every selected id that is no longer in the document. */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Open or close a text editor. */
  | { type: 'edit'; id: string | null };

const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Fold a candidate selection back into a state: an editor that is open on an object
 * outside the selection cannot exist, an empty selection is the one shared empty
 * state, and nothing that did not change produces a new object — so an unrelated
 * document change does not re-render the board.
 */
function fold(ids: ReadonlySet<string>, editingId: string | null, state: SelectionState): SelectionState {
  const editor = editingId !== null && ids.has(editingId) ? editingId : null;
  if (sameIds(state.ids, ids) && state.editingId === editor) return state;
  if (ids.size === 0 && editor === null) return emptySelection;
  return { ids: new Set(ids), editingId: editor };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id)) return fold(state.ids, null, state);
      return fold(new Set([action.id]), null, state);
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return fold(ids, state.editingId, state);
    }
    case 'setMany': {
      if (!action.additive) return fold(new Set(action.ids), null, state);
      const ids = new Set(state.ids);
      for (const id of action.ids) ids.add(id);
      return fold(ids, state.editingId, state);
    }
    case 'clear':
      return fold(new Set<string>(), null, state);
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      return fold(ids, state.editingId, state);
    }
    case 'edit': {
      if (action.id === null) return fold(state.ids, null, state);
      const ids = new Set(state.ids);
      ids.add(action.id);
      return fold(ids, action.id, state);
    }
  }
}

export interface UseSelectionResult {
  /** The selected ids. */
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Press an object: it alone is selected (shift-click toggles). */
  click(id: string): void;
  toggle(id: string): void;
  /** A marquee adds (`additive`), select-all replaces. */
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * The board's selection over `objects` (every object the document holds, of every
 * kind). The document can change under this screen at any moment — somebody else
 * deletes what is selected — so the selection is pruned against the document on every
 * change rather than checked against a snapshot the action may be a tick behind.
 */
export function useSelection(objects: readonly BoardObject[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, emptySelection);

  // Ids that exist right now. Assigned during render, so a press on an object that
  // arrived in this same render is already accounted for.
  const present = useMemo(() => new Set(objects.map((object) => object.id)), [objects]);

  // Anything somebody else deleted leaves the selection the moment it is gone
  // (TC-15, TC-16) — including the note whose editor is open.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  const click = useCallback((id: string): void => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string): void => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: readonly string[], additive: boolean): void => {
    dispatch({ type: 'setMany', ids, additive });
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
