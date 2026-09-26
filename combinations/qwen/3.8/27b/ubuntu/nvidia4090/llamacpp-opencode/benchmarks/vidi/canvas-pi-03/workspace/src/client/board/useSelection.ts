import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '@/shared/board-model';

/**
 * Local selection and editing state (story 7, multi-object).
 *
 * Selection is a per-client interaction concern: it is NEVER written to the
 * Y.Doc (other users must not see my selection as data; selection presence
 * is a later story). The state is a `ReadonlySet<string>` of object ids plus
 * the id of the object currently being edited (at most one).
 *
 * `selectionReducer` is pure and unit-tested on its own; `useSelection`
 * wraps it and keeps the set in sync with the board snapshot: when objects
 * disappear (deleted by someone else) a `prune` is dispatched so stale ids
 * leave the selection, and editing of a pruned id ends.
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

const EMPTY: ReadonlySet<string> = new Set<string>();

const initialState: SelectionState = { ids: EMPTY, editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      // A plain click replaces the set with just this object and ends any
      // editing (selecting is not editing).
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state; // re-clicking the only selected note: no change
      }
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      // Shift-click adds or removes one member.
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      const editingId =
        state.editingId === action.id && !next.has(action.id) ? null : state.editingId;
      return { ids: next, editingId };
    }
    case 'setMany': {
      const next = new Set(action.additive ? state.ids : EMPTY);
      for (const id of action.ids) next.add(id);
      const editingId =
        state.editingId !== null && !next.has(state.editingId) ? null : state.editingId;
      // No-op detection keeps the state reference stable (no re-render):
      // the set is unchanged and the editing id survived.
      const sameSet =
        next.size === state.ids.size && [...next].every((id) => state.ids.has(id));
      if (sameSet && state.editingId === editingId) return state;
      return { ids: next, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: EMPTY, editingId: null };
    }
    case 'prune': {
      let idsChanged = false;
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
        else idsChanged = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (!idsChanged && state.editingId === editingId) return state;
      return { ids: next, editingId };
    }
    case 'edit': {
      if (action.id === null) {
        if (state.editingId === null) return state;
        return { ids: state.ids, editingId: null };
      }
      // Entering edit selects the object (story 2: Enter / double-click).
      const next = new Set(state.ids);
      next.add(action.id);
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === action.id) {
        return state;
      }
      return { ids: next, editingId: action.id };
    }
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Plain click: replace the selection with this object. */
  click(id: string): void;
  /** Shift-click: add or remove this object. */
  toggle(id: string): void;
  /** Marquee / select-all: replace or add a batch of ids. */
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(): void;
}

/**
 * Multi-selection state for a board snapshot (story 7). Actions referring to
 * ids absent from the current snapshot are ignored (error path: stale ids).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, initialState);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Objects deleted by other people leave the selection; editing of a
  // pruned id ends (TC-15/TC-16).
  useEffect(() => {
    const present = new Set<string>();
    for (const o of snapshot) present.add(o.id);
    dispatch({ type: 'prune', presentIds: present });
  }, [snapshot]);

  const isPresent = useCallback((id: string): boolean => {
    for (const o of snapshotRef.current) if (o.id === id) return true;
    return false;
  }, []);

  const click = useCallback(
    (id: string) => {
      if (isPresent(id)) dispatch({ type: 'click', id });
    },
    [isPresent],
  );

  const toggle = useCallback(
    (id: string) => {
      if (isPresent(id)) dispatch({ type: 'toggle', id });
    },
    [isPresent],
  );

  const setMany = useCallback(
    (ids: string[], additive: boolean) => {
      const valid: string[] = [];
      for (const id of ids) if (isPresent(id)) valid.push(id);
      if (!additive || valid.length > 0) dispatch({ type: 'setMany', ids: valid, additive });
    },
    [isPresent],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  // A brand-new object is not in the snapshot yet when the creator calls
  // startEdit (create-and-edit, story 2); queue the edit until the snapshot
  // catches up instead of dropping it.
  const pendingEditRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingEditRef.current;
    if (id === null) return;
    if (isPresent(id)) {
      pendingEditRef.current = null;
      dispatch({ type: 'edit', id });
    }
  }, [snapshot, isPresent]);

  const startEdit = useCallback(
    (id: string) => {
      if (isPresent(id)) {
        pendingEditRef.current = null;
        dispatch({ type: 'edit', id });
      } else {
        pendingEditRef.current = id;
      }
    },
    [isPresent],
  );

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
