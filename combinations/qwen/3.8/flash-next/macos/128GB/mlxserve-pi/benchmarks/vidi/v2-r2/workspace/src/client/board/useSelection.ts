// Selection state for the board (story 7: many objects, not one).
//
// The state is a Set of ids plus, at most, one object being edited. The
// reducer is exported separately from the hook - a pure transition table, so
// the state machine is unit-tested without React, in node.
//
// The states are exactly:
//   Empty            ids empty, editingId null - nothing is selected
//   Single           one id, not editing       the object's own toolbar is up
//   Single(editing)  one id, editingId it     - the text editor is open; the
//                                             object follows edits live (story 2)
//   Multiple         two or more ids, editingId null - the selection bar is up
//
// Editing is always exactly one object (there is no multi-object editor),
// which is why editingId is a nullable id and not a Set.

import { useCallback, useEffect, useReducer } from 'react';

export interface SelectionState {
  /** Selected object ids. Insertion order; the board never depends on it. */
  readonly ids: ReadonlySet<string>;
  /** The single object whose text editor is open, or null. */
  readonly editingId: string | null;
}

export type SelectionAction =
  /** A plain click on one object: it becomes the whole selection. */
  | { type: 'click'; id: string }
  /** Shift+click: add the object, or remove it if it was already in. */
  | { type: 'toggle'; id: string }
  /** Replace the selection, or, with `additive`, add a whole marquee's worth. */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  /** Empty. */
  | { type: 'clear' }
  /** Drop ids no longer on the board; the open editor decides what that means. */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /**
   * Open the text editor (the object solos into the selection - story 2's
   * one-object editor), or, with id null, close it and keep the selection.
   */
  | { type: 'edit'; id: string | null };

export function emptySelection(): SelectionState {
  return { ids: new Set<string>(), editingId: null };
}

/** True when nothing is selected - the Empty state. */
export function isEmptySelection(state: SelectionState): boolean {
  return state.ids.size === 0;
}

/** The single selected id, or null (Empty or Multiple). */
export function soloId(state: SelectionState): string | null {
  if (state.ids.size !== 1) return null;
  return state.ids.values().next().value ?? null;
}

/**
 * The transition table. Rules worth naming, all of them tested:
 *   - clicking the only object already selected changes nothing;
 *   - the last id toggled or pruned away returns the very Empty state object;
 *   - prune of a selection without any gone id returns the same state, so an
 *     object a peer is merely *editing* (which keeps it live) never flickers;
 *   - `edit` solos the object: story 2's contract that a text editor is
 *     always exactly one object; `edit` with id null closes it and keeps the
 *     selection (that is Escape); an open editor's selection is its own, so
 *     `setMany` adds to it without disturbing it, and if the edited object
 *     vanishes from the board the whole editing selection dissolves;
 *   - an action naming no usable id (empty string, non-string) is always a
 *     no-op.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      const id = action.id;
      if (typeof id !== 'string' || id === '') return state;
      if (state.ids.size === 1 && state.ids.has(id) && state.editingId === null) return state;
      return { ids: new Set([id]), editingId: null };
    }
    case 'toggle': {
      const id = action.id;
      if (typeof id !== 'string' || id === '') return state;
      const next = new Set(state.ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return emptySelection();
      return { ids: next, editingId: null };
    }
    case 'setMany': {
      const incoming = action.ids.filter(
        (id): id is string => typeof id === 'string' && id !== '',
      );
      if (!action.additive) {
        if (incoming.length === 0) return emptySelection();
        return { ids: new Set(incoming), editingId: null };
      }
      if (incoming.length === 0) return state; // adding nothing changes nothing
      const next = new Set(state.ids);
      for (const id of incoming) next.add(id);
      // an open editor keeps its editing id: the marquee cannot steal it
      return { ids: next, editingId: state.editingId };
    }
    case 'clear':
      return emptySelection();
    case 'prune': {
      const present = action.presentIds;
      // The open editor owns its selection; if its object vanishes from
      // under it, the editing selection dissolves rather than limping on.
      if (state.editingId !== null && !present.has(state.editingId)) return emptySelection();
      const gone: string[] = [];
      for (const id of state.ids) if (!present.has(id)) gone.push(id);
      if (gone.length === 0) return state;
      const next = new Set(state.ids);
      for (const id of gone) next.delete(id);
      if (next.size === 0) return emptySelection();
      return { ids: next, editingId: state.editingId };
    }
    case 'edit': {
      const id = action.id;
      if (id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      if (typeof id !== 'string' || id === '') return state;
      if (state.editingId === id && state.ids.size === 1 && state.ids.has(id)) return state;
      return { ids: new Set([id]), editingId: id };
    }
    default:
      return state;
  }
}

export interface UseSelection {
  /** The live selection: ids plus the editing id. */
  selection: SelectionState;
  /** True while exactly one object is selected (its toolbar may be shown). */
  selectedId: string | null;
  /** True while the text editor is open. */
  isEditing: boolean;
  select: (id: string) => void;
  toggle: (id: string) => void;
  setSelection: (ids: readonly string[], append?: boolean) => void;
  clear: () => void;
  startEdit: (id: string) => void;
  endEdit: (next: EndEditNext) => void;
}

/**
 * The hook around the reducer. `objects` is the live snapshot list of every type;
 * whenever it changes the selection is pruned, so an object deleted by a remote
 * peer leaves the selection while a peer merely *editing* its text does not.
 *
 * It asks each object for nothing but its id, which is what lets one selection
 * hold a sticky note and a text object at the same time: a selection is a set of
 * ids and no more, and the story-9 board hands it both types together.
 */
export function useSelection(objects: readonly { id: string }[]): UseSelection {
  const [selection, dispatch] = useReducer(selectionReducer, undefined, emptySelection);

  useEffect(() => {
    const present = new Set(objects.map((o) => o.id));
    dispatch({ type: 'prune', presentIds: present });
  }, [objects]);

  const select = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setSelection = useCallback(
    (ids: readonly string[], additive = false) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  // Story 2's contract, kept: Escape ends editing and keeps the note selected;
  // a click outside the note ends editing and deselects.
  const endEdit = useCallback(
    (next: EndEditNext) =>
      dispatch(next === 'selected' ? { type: 'edit', id: null } : { type: 'clear' }),
    [],
  );

  return {
    selection,
    selectedId: soloId(selection),
    isEditing: selection.editingId !== null,
    select,
    toggle,
    setSelection,
    clear,
    startEdit,
    endEdit,
  };
}

/** What StickyTextEditor asks for when it leaves the editor (story 2): keep
 * the note selected (Escape), or deselect entirely (click outside). */
export type EndEditNext = 'selected' | 'unselected';
