import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Multi-selection (story 7), replacing the story-2 single-selection reducer.
 *
 * State:
 *  - `ids`: the selected object ids (Set; empty = nothing selected).
 *  - `editingId`: the object currently in text editing (at most one; implies
 *    membership in `ids`).
 *
 * Every action is validated against the live snapshot through the wrapper
 * callbacks: actions referring to non-existent ids are ignored. A `prune`
 * effect drops ids that left the board (remote delete, doc replace) and
 * clears `editingId` when its object vanished.
 *
 * The reducer is a pure exported function so the tests exercise it directly.
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: new Set<string>(), editingId: null };

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // A plain press selects exactly this object. Re-clicking the only
      // selected object keeps the selection (no-op, same state object).
      if (state.editingId === null && state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      if (state.editingId === null && setsEqual(next, state.ids)) return state;
      return { ids: next, editingId: null };
    }
    case 'setMany': {
      const next = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      if (state.editingId === null && setsEqual(next, state.ids)) return state;
      return { ids: next, editingId: null };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : { ids: new Set(), editingId: null };
    case 'prune': {
      let removed = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else removed = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (!removed && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ids: state.ids, editingId: null };
      }
      if (state.editingId === action.id && state.ids.has(action.id)) return state;
      // Editing always selects exactly this object (double-click / Enter).
      return { ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface Selection {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Plain press on an object: select exactly it (no-op when it is the only selected id). */
  click: (id: string) => void;
  /** Shift press on an object: add/remove it. */
  toggle: (id: string) => void;
  /** Replace (or additively extend, for the marquee) the selection. */
  setMany: (ids: readonly string[], additive: boolean) => void;
  /** Empty-space press / Escape. */
  clear: () => void;
  /** Start editing `id` (selects it exclusively). */
  startEdit: (id: string) => void;
  /** End editing; the selection is kept. */
  endEdit: () => void;
}

export function useSelection(
  snapshot: readonly ObjectSnapshot[],
  /**
   * Optional live presence check (e.g. `hasObject` on the doc). The rendered
   * snapshot can lag a local write: creating a note and selecting it happen
   * in one event, before the snapshot re-render. Absent ids are still
   * ignored (error path) — the fallback only admits live objects.
   */
  isPresent?: (id: string) => boolean,
): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Prune ids that left the board (remote delete, doc replace). The snapshot
  // reference only changes when the doc changes, so this is cheap.
  useEffect(() => {
    const present = new Set<string>();
    for (const o of snapshot) present.add(o.id);
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const isPresentRef = useRef(isPresent);
  isPresentRef.current = isPresent;

  const present = useCallback((id: string): boolean => {
    for (const o of snapshotRef.current) if (o.id === id) return true;
    return isPresentRef.current?.(id) ?? false;
  }, []);

  const click = useCallback(
    (id: string): void => {
      if (present(id)) dispatch({ type: 'click', id });
    },
    [present],
  );

  const toggle = useCallback(
    (id: string): void => {
      if (present(id)) dispatch({ type: 'toggle', id });
    },
    [present],
  );

  const setMany = useCallback(
    (ids: readonly string[], additive: boolean): void => {
      if (ids.length === 0) {
        // Ctrl+A on an empty board selects nothing; an empty marquee result
        // leaves the selection unchanged.
        if (!additive) dispatch({ type: 'clear' });
        return;
      }
      const valid = ids.filter((id) => present(id));
      if (valid.length === 0) return; // all stale: ignored
      dispatch({ type: 'setMany', ids: valid, additive });
    },
    [present],
  );

  const clear = useCallback((): void => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback(
    (id: string): void => {
      if (present(id)) dispatch({ type: 'edit', id });
    },
    [present],
  );

  const endEdit = useCallback((): void => {
    dispatch({ type: 'edit', id: null });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
