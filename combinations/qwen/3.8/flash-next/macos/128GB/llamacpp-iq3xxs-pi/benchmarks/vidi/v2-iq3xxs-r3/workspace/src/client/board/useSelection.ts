import { useCallback, useEffect, useReducer } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';

/* --- Story 7: selection of many objects -------------------------------- */

/**
 * What one screen has selected. `ids` is the selection — a new `Set` whenever it
 * changes, so React sees the change — and `editingId` is the object whose text is
 * being typed into, which is always one of them.
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

/** Nobody and nothing selected. */
export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * The things that can change a selection: clicking one object, Shift-clicking it
 * in or out, setting many at once (marquee, select all), clearing it, dropping
 * objects that another person deleted, and starting or ending a text edit.
 */
export type SelectionAction =
  | { readonly type: 'click'; readonly id: string }
  | { readonly type: 'toggle'; readonly id: string }
  | { readonly type: 'setMany'; readonly ids: readonly string[]; readonly additive: boolean }
  | { readonly type: 'clear' }
  | { readonly type: 'prune'; readonly presentIds: ReadonlySet<string> }
  | { readonly type: 'edit'; readonly id: string | null };

/** Two selections that would be drawn identically. */
function sameIds(one: ReadonlySet<string>, other: ReadonlySet<string>): boolean {
  return one.size === other.size && [...one].every((id) => other.has(id));
}

/** The object being typed into, still in this selection (or nothing is). */
function editedStillIn(
  editingId: string | null,
  ids: ReadonlySet<string>,
  presentIds?: ReadonlySet<string>,
): string | null {
  if (editingId === null) return null;
  if (!ids.has(editingId)) return null;
  return presentIds === undefined || presentIds.has(editingId) ? editingId : null;
}

/**
 * The whole of selection logic, pure (`sel.interaction`): the function a unit
 * test drives with `{}` → `{a}` → `{a,b}` → `{b}`, and the board drives with
 * pointer events. It returns the state it was handed whenever an action would
 * change nothing, so a document that changed for other reasons does not re-render
 * the selection — and so a selection that did not change stays one set of
 * objects.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      const editingId = state.editingId === action.id ? state.editingId : null;
      return sameIds(state.ids, ids) && state.editingId === editingId
        ? state
        : { ids, editingId };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      const wasIn = ids.has(action.id);
      if (wasIn) ids.delete(action.id);
      else ids.add(action.id);
      // Shift-clicking the object being typed into takes it out, and the edit
      // goes with it; anything else leaves the editor alone.
      const editingId = wasIn && state.editingId === action.id ? null : state.editingId;
      return sameIds(state.ids, ids) && state.editingId === editingId
        ? state
        : { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive
        ? new Set([...state.ids, ...action.ids])
        : new Set(action.ids);
      const editingId = editedStillIn(state.editingId, ids);
      if (sameIds(state.ids, ids) && state.editingId === editingId) return state;
      return { ids, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set<string>(), editingId: null };
    }
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId = editedStillIn(state.editingId, state.ids, action.presentIds);
      return sameIds(state.ids, ids) && state.editingId === editingId
        ? state
        : { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        // Typing stops; what was selected is still selected, because stopping
        // mid-sentence is not a reason to lose track of the object.
        return state.editingId === null ? state : { ids: state.ids, editingId: null };
      }
      // Typing into one object of many selects it alone: the editor and the
      // selection bar would otherwise fight over the same rectangle.
      const ids = new Set<string>([action.id]);
      return sameIds(state.ids, ids) && state.editingId === action.id
        ? state
        : { ids, editingId: action.id };
    }
  }
}

/**
 * The selection as the board needs it: the ids, the object being typed into, and
 * one method per way of changing it. Everything here is synchronous and stable
 * across renders, so a pointer handler can hold on to it without re-subscribing.
 */
export interface SelectionController {
  /** The selected ids; empty when nothing is selected. */
  readonly ids: ReadonlySet<string>;
  /** The object whose text is being edited, always one of `ids`. */
  readonly editingId: string | null;
  /** Plain click or tap on one object: it becomes the whole selection. */
  click(id: string): void;
  /** Shift-click: in if it was out, out if it was in. */
  toggle(id: string): void;
  /** A marquee or select-all: `additive` Shift-drag adds to what is selected. */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Escape, or a click on empty board space. */
  clear(): void;
  /** Start typing into `id`, which becomes the selection. */
  startEdit(id: string): void;
  /** Stop typing; the selection stays. */
  endEdit(): void;
}

/**
 * Selection for one screen, of as many objects as the board holds — per-client
 * interaction state, never written to the Y.Doc, because another person's cursor
 * must not change what you have selected (`live.local_selection`).
 *
 * `snapshot` is what the board can currently draw: objects that vanish from it —
 * deleted by somebody else while you had them selected — leave the selection
 * with it, and the editor of an object that vanishes unmounts rather than
 * reporting an error (`live.delete_during_edit`).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionController {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds: new Set(snapshot.map((object) => object.id)) });
  }, [snapshot]);

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

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
