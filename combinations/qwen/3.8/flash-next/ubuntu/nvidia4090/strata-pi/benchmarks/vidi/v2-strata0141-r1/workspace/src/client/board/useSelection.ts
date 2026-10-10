import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Selection, per client. Story 7 turned story 2's `selectedId: string | null`
 * into a set of ids, and moved every selection rule into one pure reducer so
 * the whole of `sel.interaction` can be read - and tested - in one place.
 *
 * Selection is never written to the Y.Doc (Key decision 6): what one person has
 * selected is not part of the board.
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

const stillEditing = (state: SelectionState, ids: ReadonlySet<string>): string | null =>
  state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;

/**
 * The selection rules (`sel.interaction`).
 *
 * - click replaces the whole set, Shift-click toggles one member;
 * - a marquee or select-all sets many, additively or not;
 * - `prune` drops what other people deleted (TC-15);
 * - `edit` is the Editing --> Some transition: editing an object selects it,
 *   ending editing keeps the selection.
 *
 * Nothing here mutates its input: every action builds a new set.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!action.id) {
        return state;
      }
      // Clicking the object that is already the only thing selected, and is
      // being edited, keeps the edit open; anything else closes it.
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      return { ids: new Set([action.id]), editingId: null };
    }

    case 'toggle': {
      if (!action.id) {
        return state;
      }
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      return { ids, editingId: stillEditing(state, ids) };
    }

    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) {
        if (id) {
          ids.add(id);
        }
      }
      return { ids, editingId: stillEditing(state, ids) };
    }

    case 'clear':
      return EMPTY;

    case 'prune': {
      const ids = new Set<string>();
      state.ids.forEach((id) => {
        if (action.presentIds.has(id)) {
          ids.add(id);
        }
      });
      if (ids.size === state.ids.size) {
        return state; // nothing other people did affected this selection
      }
      return { ids, editingId: stillEditing(state, ids) };
    }

    case 'edit': {
      if (action.id === null) {
        // Escape: the editor closes, the selection stays (`Editing --> Some`).
        return { ids: state.ids, editingId: null };
      }
      return { ids: new Set([action.id]), editingId: action.id };
    }
  }
}

export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** A plain click on an object: replace the selection. */
  click(id: string): void;
  /** Shift-click: add or remove one object. */
  toggle(id: string): void;
  /** Marquee (additive) or select all (not additive). */
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
  /** True when this id is selected. */
  has(id: string): boolean;
}

/**
 * The selection of one client, kept in sync with the board it is looking at.
 *
 * The snapshot is the source of truth for what exists: whenever it changes the
 * selection is pruned, so a note someone else deleted leaves this selection at
 * once (TC-15, TC-35), and an id that is not on the board does not stay
 * selected.
 *
 * Pruning rather than rejecting is deliberate. A note created a moment ago is
 * not in the snapshot this render was drawn from, and selecting it is exactly
 * what `BoardView.createAt` has to do for story 2's "editing starts immediately
 * when a note is created" (TC-23) - an id that really is not on the board is
 * dropped by the next prune instead.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY);

  const presentIds = useMemo(
    () => new Set(snapshot.map((obj) => obj.id)),
    [snapshot],
  );

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);

  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);

  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  const has = useCallback((id: string) => state.ids.has(id), [state.ids]);

  return {
    ids: state.ids,
    editingId: state.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
    has,
  };
}

