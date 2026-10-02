import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Local selection state (story 7, sel.state): a multi-select id set plus the
 * object being edited. Purely local (never synced), with a pure reducer so
 * the transitions are unit-testable.
 *
 * Rules (PRD sel.select / sel.remote_sync):
 * - click            → select just that object
 * - shift+click      → toggle that object
 * - setMany(ids)     → replace (Ctrl+A) or union (marquee, additive)
 * - clear            → empty selection, end editing
 * - prune(presentIds)→ drop ids that no longer exist (remote deletes)
 *
 * Selection is always pruned when a selected object is deleted by someone
 * else (locally or remotely) — the selection never keeps ghosts.
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
  | { type: 'edit'; id: string }
  | { type: 'endEdit' };

export const initialSelectionState: SelectionState = { ids: new Set(), editingId: null };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      const editingId =
        state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      if (sameIds(next, state.ids) && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'setMany': {
      const next = new Set(state.ids);
      if (!action.additive) next.clear();
      for (const id of action.ids) next.add(id);
      const editingId =
        state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      if (sameIds(next, state.ids) && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: new Set(), editingId: null };
    }
    case 'prune': {
      let dropped = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else dropped = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId)
          ? null
          : state.editingId;
      if (!dropped && editingId === state.editingId) return state;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (!state.ids.has(action.id) || state.editingId === action.id) return state;
      return { ids: state.ids, editingId: action.id };
    }
    case 'endEdit': {
      if (state.editingId === null) return state;
      return { ids: state.ids, editingId: null };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  /** The selected object ids. */
  readonly ids: ReadonlySet<string>;
  /** The object currently being edited (text), if any. */
  readonly editingId: string | null;
  /** Select just `id` (deselects the rest). */
  click: (id: string) => void;
  /** Add/remove `id` (Shift+click). */
  toggle: (id: string) => void;
  /** Replace the selection (`additive=false`) or union ids into it (`additive=true`). */
  setMany: (ids: readonly string[], additive?: boolean) => void;
  /** Empty the selection and end editing. */
  clear: () => void;
  /** Start editing `id` (it must be selected). */
  startEdit: (id: string) => void;
  /** End editing (the selection is kept). */
  endEdit: () => void;
}

/**
 * Multi-selection state driven by `snapshot` (the board objects). Actions
 * referencing ids that are not in the snapshot are ignored (defensive: stale
 * events), and the selection is pruned whenever the snapshot changes.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, initialSelectionState);

  // The ids present in the snapshot, kept in a ref for the stable callbacks.
  const presentRef = useRef<ReadonlySet<string>>(new Set());
  presentRef.current = new Set(snapshot.map((o) => o.id));

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);
  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);
  const setMany = useCallback((ids: readonly string[], additive = false) => {
    const filtered = ids.filter((id) => presentRef.current.has(id));
    if (filtered.length > 0) dispatch({ type: 'setMany', ids: filtered, additive });
  }, []);
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => {
    // Start editing also selects (story 2 semantics: the toolbar/edit flow
    // starts from create-and-edit, where the snapshot has not re-rendered
    // yet). A stale id is pruned with the next snapshot change.
    dispatch({ type: 'setMany', ids: [id], additive: false });
    dispatch({ type: 'edit', id });
  }, []);
  const endEdit = useCallback(() => dispatch({ type: 'endEdit' }), []);

  // Prune ghosts when the snapshot changes (remote deletes, etc.).
  useEffect(() => {
    const present = presentRef.current;
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

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
