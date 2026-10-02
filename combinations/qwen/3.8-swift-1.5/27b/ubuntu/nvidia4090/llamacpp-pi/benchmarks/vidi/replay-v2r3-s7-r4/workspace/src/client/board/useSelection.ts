import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Story 7: per-client multi-selection state.
 *
 * The selection is a Set of object ids plus the id being edited (always a
 * subset of the selection). It is local to this client — never written to
 * the Y.Doc.
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

const EMPTY: ReadonlySet<string> = new Set();

export const initialSelectionState: SelectionState = { ids: EMPTY, editingId: null };

function keepEditing(state: SelectionState, ids: ReadonlySet<string>): string | null {
  return state.editingId !== null && ids.has(state.editingId) ? state.editingId : null;
}

/**
 * Pure selection reducer (sel.interaction).
 *
 * - `click` replaces the set with just `id`
 * - `toggle` adds `id` if absent, removes it if present
 * - `setMany` adds (additive) or replaces (non-additive)
 * - `clear` empties the selection and ends editing
 * - `prune` drops ids no longer present on the board (remote deletes); ends
 *   editing if the edited id was pruned
 * - `edit` sets the editing id (null ends editing)
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      return {
        ids: new Set([action.id]),
        editingId: state.editingId === action.id ? state.editingId : null,
      };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: keepEditing(state, ids) };
    }
    case 'setMany': {
      const ids = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      return { ids, editingId: keepEditing(state, ids) };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      let changed = false;
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
        else changed = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (!changed && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit':
      return { ids: state.ids, editingId: action.id };
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * Multi-selection hook. `snapshot` is the current board snapshot; a snapshot
 * change dispatches `prune` so objects deleted by other people leave the
 * selection (and editing of a pruned id ends). Actions for ids that are not
 * on the board are ignored.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, initialSelectionState);

  const presentIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);

  useEffect(() => {
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'click', id });
    },
    [presentIds],
  );

  const toggle = useCallback(
    (id: string) => {
      if (presentIds.has(id)) dispatch({ type: 'toggle', id });
    },
    [presentIds],
  );

  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  // No presentIds guard: starting to edit a just-created object happens in
  // the same tick as its creation (before the snapshot updates); a stale id
  // is cleaned up by the next `prune`.
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

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
