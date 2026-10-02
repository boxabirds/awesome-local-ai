import { useCallback, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

// ---------------------------------------------------------------------------
// Pure selection state machine (sel.interaction)
// ---------------------------------------------------------------------------

export interface MultiSelectionState {
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

/**
 * Pure selection reducer. `click` replaces the set with the single id (and
 * ends editing of anything else); `toggle` adds/removes one id; `setMany`
 * replaces (or, additive, unions with) the set; `prune` drops ids no longer
 * present on the board and ends editing if the edited id vanished.
 */
export function selectionReducer(
  state: MultiSelectionState,
  action: SelectionAction,
): MultiSelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set<string>([action.id]);
      return { ids, editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return {
        ids,
        editingId: state.editingId && !ids.has(state.editingId) ? null : state.editingId,
      };
    }
    case 'setMany': {
      const ids = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      return {
        ids,
        editingId: state.editingId && !ids.has(state.editingId) ? null : state.editingId,
      };
    }
    case 'clear':
      return { ids: new Set<string>(), editingId: null };
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) ids.add(id);
      }
      const editingId = state.editingId && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids, editingId };
    }
    case 'edit': {
      if (action.id === null) return { ids: state.ids, editingId: null };
      // Editing implies selection (double-click on an unselected object).
      const ids = state.ids.has(action.id) ? state.ids : new Set([...state.ids, action.id]);
      return { ids, editingId: action.id };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface Selection {
  /** The current selection (empty set = nothing selected). */
  readonly ids: ReadonlySet<string>;
  editingId: string | null;
  has: (id: string) => boolean;
  size: number;
  /** Plain click: select exactly this object (replaces the set). */
  click: (id: string) => void;
  /** Shift-click: add/remove this object, keeping the rest. */
  toggle: (id: string) => void;
  /** Marquee / select-all. `additive` unions with the current selection. */
  setMany: (ids: string[], additive: boolean) => void;
  clear: () => void;
  startEdit: (id: string) => void;
  endEdit: () => void;
}

/**
 * Multi-selection for the local user only. Selection is never synced (the
 * story 3 doc stays sticky-only); it is derived from the live snapshot, and
 * ids are pruned when objects disappear (e.g. deleted by a colleague).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  // Prune ids that vanished from the board (remote delete etc.).
  const lastSnapshotRef = useRef<readonly ObjectSnapshot[]>(snapshot);
  if (lastSnapshotRef.current !== snapshot) {
    lastSnapshotRef.current = snapshot;
    const presentIds = new Set<string>(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', presentIds });
  }

  const has = useCallback((id: string) => state.ids.has(id), [state.ids]);
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
    has,
    size: state.ids.size,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
