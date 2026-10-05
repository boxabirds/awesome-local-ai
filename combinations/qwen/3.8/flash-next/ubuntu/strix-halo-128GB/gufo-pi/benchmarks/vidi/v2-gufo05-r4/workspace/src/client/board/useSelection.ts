/**
 * Which objects are selected, and which one is being typed into.
 *
 * This is *per-client* interaction state: two people on the same board (story 3) each
 * have their own selection, so it is never written to the shared document. Story 2
 * kept one id; story 7 keeps a set, because moving a cluster of notes is one gesture
 * over several objects — and a set of one is exactly what a single click used to make.
 *
 * Every change goes through {@link selectionReducer}, which is a pure function of the
 * previous ids and one action, so the whole ruleset — click replaces, Shift-click
 * toggles, a marquee adds, somebody else's delete prunes — is testable without a DOM.
 * The one place the *board* speaks back is `prune`: an object another person deleted
 * leaves the selection on its own (`sel.remote_delete`), rather than being an id that
 * a later gesture tries to move.
 */

import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { allObjectIds, type ObjectSnapshot } from '../../shared/board-model';

/** Where editing leaves the note. */
export type EndEditNext = 'selected' | 'unselected';

/** The per-client selection: which ids, and which of them is being typed into. */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

/**
 * Every way the selection changes.
 *
 * `click` is a press without Shift, `toggle` a press with it, `setMany` a marquee
 * (additive) or Select all (not), and `prune` the board telling the selection that
 * some of its objects are gone. `edit` opens a text editor, and `edit` with `null`
 * closes it without touching which objects are selected.
 */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * The selection rules, with nothing else in them.
 *
 * Closing an editor with `endEdit('unselected')` is two actions from the hook rather
 * than a third kind of action here: the reducer's job is which *objects* are selected,
 * and dropping a selection is already `clear`.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) return state;
      return { ids: new Set([action.id]), editingId: state.editingId };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      // Toggling the note you are typing into closes the editor with it.
      const editingId = action.id === state.editingId ? null : state.editingId;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      if (ids.size === state.ids.size && [...ids].every((id) => state.ids.has(id))) return state;
      return { ids, editingId: state.editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return EMPTY_SELECTION;
    }
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      // Editing an object selects it and nothing else: you type into one thing at a
      // time, and a selection that survived would have its text changed under you.
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface SelectionControls {
  /** Every selected object id, in the order they were added. */
  readonly ids: ReadonlySet<string>;
  /**
   * The sole selected id, or null. Story 2's shape, kept because a selection of one is
   * what "the selected note" means for its toolbar and its Enter-to-edit shortcut.
   */
  readonly selectedId: string | null;
  /** The note whose textarea is open, if any. */
  readonly editingId: string | null;
  /** Select one object, dropping every other selection (a press without Shift). */
  click(id: string): void;
  /** Add or remove one object, leaving the rest alone (a press with Shift). */
  toggle(id: string): void;
  /** Select a list of objects, either beside or instead of the current selection. */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Drop the whole selection and any open editor. */
  clear(): void;
  /** Story 2's name for the same thing: `select(id)` clicks it, `select(null)` clears. */
  select(id: string | null): void;
  /** Open the note's textarea; the note is selected while editing. */
  startEdit(id: string): void;
  /** Close the textarea, keeping or dropping the selection. */
  endEdit(next?: EndEditNext): void;
}

/**
 * The selection, kept in step with the board.
 *
 * It is given the current objects so it can drop ids that are no longer there: an
 * object somebody else deletes leaves the selection and the rest of it carries on
 * (`sel.remote_delete`), and an editor they deleted underneath you closes quietly.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionControls {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // A set is rebuilt whenever the document changes, which is the only moment an id can
  // have gone missing. `allObjectIds` is the same list Select all offers, so what can be
  // selected and what survives a prune are the same rule.
  //
  // A board that is being collaborated on changes often and is usually selected by nobody,
  // so nothing is dispatched at all until there is something to prune: an empty selection
  // has no ids that could have gone missing, and a dispatch per remote update on a quiet
  // selection is work nobody asked for.
  const prunable = state.ids.size > 0 || state.editingId !== null;
  useEffect(() => {
    if (!prunable) return;
    dispatch({ type: 'prune', presentIds: new Set(allObjectIds(snapshot)) });
  }, [snapshot, prunable]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => dispatch({ type: 'setMany', ids: [...ids], additive }),
    []
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const select = useCallback((id: string | null) => dispatch(id === null ? { type: 'clear' } : { type: 'click', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: EndEditNext = 'selected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  const selectedId = state.ids.size === 1 ? [...state.ids][0]! : null;

  return useMemo(
    () => ({ ids: state.ids, selectedId, editingId: state.editingId, click, toggle, setMany, clear, select, startEdit, endEdit }),
    [state.ids, selectedId, state.editingId, click, toggle, setMany, clear, select, startEdit, endEdit]
  );
}
