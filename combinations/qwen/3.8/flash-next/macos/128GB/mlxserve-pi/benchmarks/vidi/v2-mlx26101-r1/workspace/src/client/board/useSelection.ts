// Per-client selection state (story 7).
//
// Story 2 selected one note; story 7 selects many. The selection is a `Set` of
// ids plus an optional "editing" id, kept in a pure reducer so the click / shift-
// click / marquee / select-all / clear / prune rules are testable without React.
// It is *local* state and is never written to the shared document: which notes one
// person has selected must not appear on anyone else's screen (sel.interaction).
//
// `prune` is the collaboration rule: when other people delete objects from under
// us, those ids simply drop out of our selection (and an edit on a vanished object
// ends), while everything still present stays selected (sel.remote_delete).

import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** What selection to land on when text editing finishes. */
export type EndEditTarget = 'selected' | 'unselected';

export interface SelectionState {
  /** Selected object ids. */
  readonly ids: ReadonlySet<string>;
  /** Id whose text is being edited, or null. Always a member of `ids`. */
  readonly editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const EMPTY: ReadonlySet<string> = new Set<string>();

const INITIAL: SelectionState = { ids: EMPTY, editingId: null };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * The pure selection state machine. `click` replaces the selection with one object;
 * `toggle` adds/removes one (shift-click) and may empty it; `setMany` sets (select
 * all) or extends (marquee) the selection; `clear` empties it; `prune` drops ids no
 * longer present; `edit` opens (or closes) text editing on a single object.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click':
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null)
        return state;
      return { ids: new Set([action.id]), editingId: null };

    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ids: next, editingId: state.editingId };
    }

    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        if (sameIds(next, state.ids) && state.editingId === null) return state;
        return { ids: next, editingId: null };
      }
      if (sameIds(state.ids, new Set(action.ids)) && state.editingId === null)
        return state;
      return { ids: new Set(action.ids), editingId: null };
    }

    case 'clear':
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: EMPTY, editingId: null };

    case 'prune': {
      let ids: ReadonlySet<string> = state.ids;
      let changed = false;
      const kept = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) kept.add(id);
        else changed = true;
      }
      if (changed) ids = kept;
      let editingId = state.editingId;
      if (editingId !== null && !action.presentIds.has(editingId)) {
        editingId = null;
        changed = true;
      }
      if (!changed) return state;
      return { ids, editingId };
    }

    case 'edit':
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      return { ids: new Set([action.id]), editingId: action.id };
  }
}

export interface SelectionApi {
  /** The selected object ids. */
  ids: ReadonlySet<string>;
  /** Id of the note whose text is being edited, or null. */
  editingId: string | null;
  /** Select only `id` (a plain click). Always drops editing. */
  click(id: string): void;
  /** Add or remove `id` from the selection (a shift-click). */
  toggle(id: string): void;
  /** Replace (additive false) or extend (additive true) the selection. */
  setMany(ids: string[], additive: boolean): void;
  /** Clear the whole selection (and any edit). */
  clear(): void;
  /** Begin editing `id`'s text (implies it is the only selection). */
  startEdit(id: string): void;
  /** Finish editing, keeping the object selected. */
  endEdit(): void;
}

/**
 * React binding over `selectionReducer`. Every snapshot change dispatches a
 * `prune` so objects other people deleted leave this selection automatically; the
 * reducer returns the same state when nothing actually dropped out, so a plain
 * remote move does not re-render us.
 */
export function useSelection(
  snapshot: readonly ObjectSnapshot[],
): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, INITIAL);

  // Keep the selection honest about what still exists. The reducer no-ops when the
  // pruned id was not in the selection, so this fires harmlessly on every change.
  useEffect(() => {
    const present = new Set(snapshot.map((o) => o.id));
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

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
