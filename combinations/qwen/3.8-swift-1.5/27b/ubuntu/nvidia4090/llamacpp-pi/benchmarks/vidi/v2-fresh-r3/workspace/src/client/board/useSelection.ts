import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Per-client selection state (story 7). Not persisted, never written to the
 * Y.Doc: two people can select and edit different objects independently
 * (story 3).
 */
export interface SelectionState {
  ids: ReadonlySet<string>;
  editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Pure selection reducer (sel.interaction):
 * - `click` replaces the set (a plain click selects only that object);
 * - `toggle` adds/removes one id (Shift-click);
 * - `setMany` replaces, or adds when `additive` (marquee / select all);
 * - `clear` empties the selection and ends editing;
 * - `prune` drops ids no longer on the board (remote delete, sel.remote_delete)
 *   and ends editing of a pruned id;
 * - `edit` starts/ends text editing.
 * Actions that change nothing return the same state reference (React bail-out).
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
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
      const editingId =
        state.editingId === action.id && !ids.has(action.id) ? null : state.editingId;
      if (sameSet(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive
        ? new Set([...state.ids, ...action.ids])
        : new Set(action.ids);
      if (sameSet(ids, state.ids) && state.editingId !== null) return state;
      if (sameSet(ids, state.ids)) return state;
      return { ids, editingId: state.editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId)
          ? null
          : state.editingId;
      if (sameSet(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit': {
      if (state.editingId === action.id) return state;
      return { ...state, editingId: action.id };
    }
  }
}

export interface UseSelectionResult {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Plain click: `id` becomes the only selected object. */
  click(id: string): void;
  /** Shift-click: add `id` if absent, remove it if selected. */
  toggle(id: string): void;
  /** Marquee / select all. `additive` keeps the current selection. */
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

const EMPTY: SelectionState = { ids: new Set<string>(), editingId: null };

/**
 * Local per-client multi-selection (story 7). A snapshot change dispatches
 * `prune` so ids deleted by other people leave the selection (and editing of
 * a pruned id ends). Actions referring to ids absent from the snapshot are
 * ignored. The selection is never written to the doc.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY);

  const presentRef = useRef<ReadonlySet<string>>(new Set());
  presentRef.current = new Set(snapshot.map((o) => o.id));

  // Remote deletes: prune ids that left the board.
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: presentRef.current });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback(() => {
    dispatch({ type: 'edit', id: null });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
