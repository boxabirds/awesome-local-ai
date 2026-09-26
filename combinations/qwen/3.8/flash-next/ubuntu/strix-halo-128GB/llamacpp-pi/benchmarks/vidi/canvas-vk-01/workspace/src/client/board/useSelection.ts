import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Multi-object selection + single editing target. Selection is a *set* of ids
 * (story 7); at most one object is edited at a time. Kept entirely out of the
 * Y.Doc so another user never sees it as data.
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

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Pure selection reducer. Returns the input state unchanged (identity) when an
 * action would not change anything, so React can bail out of re-rendering —
 * this is what makes the per-doc-change `prune` effect free of charge.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      const editingId = state.editingId === action.id ? state.editingId : null;
      return { ids, editingId };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      // Editing an object that just left the selection stops editing.
      const editingId =
        state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId;
      return { ids, editingId };
    }
    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      if (ids.size === 0 && state.editingId === null && state.ids.size === 0) return state;
      const editingId =
        state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId;
      if (sameIds(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set<string>(), editingId: null };
    }
    case 'prune': {
      const present = action.presentIds;
      let ids: Set<string> | null = null;
      for (const id of state.ids) {
        if (!present.has(id)) {
          ids ??= new Set(state.ids);
          ids.delete(id);
        }
      }
      const editingId =
        state.editingId !== null && !present.has(state.editingId) ? null : state.editingId;
      if (ids === null && editingId === state.editingId) return state;
      return { ids: ids ?? state.ids, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      const ids = new Set<string>([action.id]);
      return { ids, editingId: action.id };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  ids: ReadonlySet<string>;
  editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * The selection hook. `snapshot` is the current object list; the selection is
 * pruned to objects that still exist whenever the snapshot changes (a remote
 * delete must not leave a stale id selected).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  // Prune to present objects on every snapshot change. The reducer returns the
  // same state when nothing is stale, so this never re-renders for a no-op.
  const presentIds = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
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
