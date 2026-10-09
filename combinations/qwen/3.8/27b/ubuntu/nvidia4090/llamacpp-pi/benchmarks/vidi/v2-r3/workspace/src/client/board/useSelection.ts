import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Story 7 (sel.interaction): multi-selection state.
 *
 * The selection is a set of object ids plus the id being edited (or null).
 * It is pure client state: it is never written to the Y.Doc. A `prune`
 * action keeps it in sync with the snapshot, so ids deleted by someone else
 * leave the selection (and editing of a pruned id ends).
 *
 * `presentIds` mirrors the ids currently in the snapshot; actions that refer
 * to absent ids are ignored (error path).
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  readonly presentIds: ReadonlySet<string>;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

function initialSelectionState(snapshot: readonly ObjectSnapshot[]): SelectionState {
  return {
    ids: new Set<string>(),
    editingId: null,
    presentIds: new Set(snapshot.map((o) => o.id)),
  };
}

export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case 'click': {
      // Clicking replaces the whole selection with just this object.
      if (!state.presentIds.has(action.id)) return state;
      return { ...state, ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      // Shift-click adds/removes one object.
      if (!state.presentIds.has(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ...state, ids };
    }
    case 'setMany': {
      // Marquee / select-all. Only ids present in the snapshot count; absent
      // ids are ignored. Additive unions with the current selection.
      const valid = action.ids.filter((id) => state.presentIds.has(id));
      let ids: Set<string>;
      if (action.additive) {
        ids = new Set(state.ids);
        for (const id of valid) ids.add(id);
      } else {
        ids = new Set(valid);
      }
      return { ...state, ids, editingId: null };
    }
    case 'clear':
      return { ...state, ids: new Set<string>(), editingId: null };
    case 'prune': {
      const present = action.presentIds;
      const ids = new Set<string>();
      for (const id of state.ids) if (present.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && present.has(state.editingId) ? state.editingId : null;
      return { ...state, ids, editingId, presentIds: present };
    }
    case 'edit': {
      if (action.id === null) {
        // endEdit: editing stops, the selection is kept.
        return { ...state, editingId: null };
      }
      if (!state.presentIds.has(action.id)) return state;
      // Editing implies selecting the edited object.
      return { ...state, ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * Multi-selection hook. `snapshot` is the current list of objects; whenever
 * the set of present ids changes a `prune` is dispatched so remotely deleted
 * ids leave the selection and editing of a pruned id ends.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, snapshot, initialSelectionState);

  // Track the set of present ids cheaply (sorted, joined) so we only prune
  // when the membership actually changes, not on every text-only update.
  const presentKey = snapshot
    .map((o) => o.id)
    .sort()
    .join('\u0000');
  const lastKeyRef = useRef(presentKey);
  useEffect(() => {
    if (lastKeyRef.current !== presentKey) {
      lastKeyRef.current = presentKey;
      dispatch({
        type: 'prune',
        presentIds: new Set(snapshot.map((o) => o.id)),
      });
    }
  }, [snapshot, presentKey]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
