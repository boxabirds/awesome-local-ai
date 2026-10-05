import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/** Where selection lands when text editing ends. */
export type EndEditTarget = 'selected' | 'unselected';

/**
 * This client's selection: which board objects the local user picked, and which
 * one their keyboard is inside.
 *
 * Never written to the Y.Doc — which note *I* have selected is not board
 * content (what other people select is presence, story 6).
 */
export interface SelectionState {
  /** Selected ids. A `Set`, so membership is O(1) for every object on screen. */
  readonly ids: ReadonlySet<string>;
  /** The id whose text the local user is editing, or `null`. */
  readonly editingId: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
  ids: new Set<string>(),
  editingId: null,
};

export type SelectionAction =
  /** Select exactly one object (a plain click, or dragging an unselected one). */
  | { type: 'click'; id: string }
  /** Add one object, or remove it if it is already in the selection. */
  | { type: 'toggle'; id: string }
  /** Select a list of ids — the marquee (additive) or select-all (not). */
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  /** Drop ids that are no longer on the board (somebody else deleted them). */
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  /** Edit one object's text, or stop editing. */
  | { type: 'edit'; id: string | null };

/**
 * The selection as a pure reducer.
 *
 * An action that changes nothing returns the *same* state object, so React skips
 * the re-render: the snapshot observer prunes on every document change, and a
 * remote keystroke must not repaint the selection.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: null };
    }
    case 'setMany': {
      if (!action.additive) {
        if (action.ids.length === 0) {
          return state.ids.size === 0 && state.editingId === null ? state : { ids: new Set(), editingId: null };
        }
        if (
          action.ids.length === state.ids.size &&
          action.ids.every((id) => state.ids.has(id))
        ) {
          return state.editingId === null ? state : { ...state, editingId: null };
        }
        return { ids: new Set(action.ids), editingId: null };
      }
      const ids = new Set(state.ids);
      let added = false;
      for (const id of action.ids) {
        if (ids.has(id)) continue;
        ids.add(id);
        added = true;
      }
      if (!added) return state.editingId === null ? state : { ...state, editingId: null };
      return { ids, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null
        ? state
        : { ids: new Set(), editingId: null };
    case 'prune': {
      let dropped = false;
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
        else dropped = true;
      }
      const editingGone = state.editingId !== null && !action.presentIds.has(state.editingId);
      if (!dropped && !editingGone) return state;
      return { ids: dropped ? ids : state.ids, editingId: editingGone ? null : state.editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ...state, editingId: null };
      }
      // Editing an object that is part of a group keeps the group; editing one
      // that is not selected (a double-click, a freshly created object) selects
      // just it.
      const ids = state.ids.has(action.id) ? state.ids : new Set([action.id]);
      if (state.editingId === action.id && ids === state.ids) return state;
      return { ids, editingId: action.id };
    }
  }
}

export interface SelectionApi {
  /** The selected ids. */
  readonly ids: ReadonlySet<string>;
  /** How many objects are selected. */
  readonly count: number;
  /** The object whose text is being edited, or `null`. */
  readonly editingId: string | null;
  /** Is this id part of the selection? */
  has(id: string): boolean;
  /** Select exactly this one (an empty id clears). */
  click(id: string | null): void;
  /** Add or remove this one, keeping the rest. */
  toggle(id: string): void;
  /** Select a list; `additive` keeps what is already selected. */
  setMany(ids: readonly string[], additive?: boolean): void;
  /** Deselect everything. */
  clear(): void;
  /** Edit one object's text. */
  startEdit(id: string): void;
  /**
   * Stop editing. `'unselected'` (a click outside the board object) drops the
   * selection too; the default keeps it.
   */
  endEdit(next?: EndEditTarget): void;
}

/**
 * Selection state for one client, kept in step with the board.
 *
 * `setMany` filters its ids against `snapshot`, so a stale or invented list (a
 * marquee computed against an old board, a deep link) cannot put a phantom in the
 * selection. `click`, `toggle` and `startEdit` do not: they name an object the
 * user is looking at, or one this client has just created, which is not in the
 * snapshot yet. Anything that turns out not to exist is dropped by the pruning
 * effect on the next board change.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // The board's live ids. `snapshot` is a fresh array whenever the document
  // changes, and the `prune` action returns the same state when it drops
  // nothing, so this costs a repaint only when a selection actually changes.
  const presentIds = useMemo(
    () => new Set(snapshot.map((object) => object.id)),
    [snapshot],
  );
  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string | null) => {
    dispatch(id === null ? { type: 'clear' } : { type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback(
    (ids: readonly string[], additive = false) => {
      const known = ids.filter((id) => presentIds.has(id));
      dispatch({ type: 'setMany', ids: known, additive });
    },
    [presentIds],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: EndEditTarget = 'selected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return useMemo(
    () => ({
      ids: state.ids,
      count: state.ids.size,
      editingId: state.editingId,
      has: (id: string) => state.ids.has(id),
      click,
      toggle,
      setMany,
      clear,
      startEdit,
      endEdit,
    }),
    [state, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
