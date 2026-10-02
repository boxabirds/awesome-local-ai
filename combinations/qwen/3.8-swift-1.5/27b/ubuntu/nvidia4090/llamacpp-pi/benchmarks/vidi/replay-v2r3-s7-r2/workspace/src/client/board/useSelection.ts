import { useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * Multi-selection state (story 7, sel.multi).
 *
 * `ids` is the set of selected object ids (any number); `editingId` is the
 * single object currently in text-editing mode (always a member of `ids`).
 * Selection is per-connection (story 3 rule: never sync it).
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

/**
 * Pure multi-selection reducer. It does not validate ids against a snapshot
 * (the hook guards those); it only computes the next state. Editing always
 * ends when the edited object leaves the selection.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      const ids = new Set([action.id]);
      return { ids, editingId: state.editingId === action.id ? state.editingId : null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: state.editingId === action.id ? null : state.editingId };
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) ids.add(id);
      return {
        ids,
        editingId: state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId,
      };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId) ? null : state.editingId;
      if (ids.size === state.ids.size && editingId === state.editingId) return state;
      return { ids, editingId };
    }
    case 'edit':
      return { ...state, editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Select exactly `id` (click). Ignored when the object no longer exists. */
  click(id: string): void;
  /** Add or remove `id` (shift-click). Ignored when the object no longer exists. */
  toggle(id: string): void;
  /** Marquee (additive) or select-all (replacing) selection. Unknown ids are filtered out. */
  setMany(ids: string[], additive: boolean): void;
  /** Empty the selection and end editing. */
  clear(): void;
  /** Select `id` and enter editing mode on it (creation / double-click / Enter). */
  startEdit(id: string): void;
  /** Leave editing mode. `next` = 'unselected' also clears the selection. */
  endEdit(next?: 'selected' | 'unselected'): void;
}

/**
 * Multi-selection hook. Prunes ids that vanished from the snapshot (e.g.
 * deleted by someone else) so a stale selection never outlives its objects.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, {
    ids: new Set<string>(),
    editingId: null,
  });

  const present = useMemo(() => new Set(snapshot.map((o) => o.id)), [snapshot]);
  const presentRef = useRef<ReadonlySet<string>>(present);
  presentRef.current = present;

  // Remote deletes: drop the vanished ids (and end editing if it vanished).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
  }, [present]);

  const click = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (!presentRef.current.has(id)) return;
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const known = ids.filter((id) => presentRef.current.has(id));
    dispatch({ type: 'setMany', ids: known, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  // No presence guard: callers pass ids that exist by construction (just
  // created in the same tick, read from the snapshot, or keyboard-focused).
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected' = 'selected') => {
    if (next === 'unselected') dispatch({ type: 'clear' });
    dispatch({ type: 'edit', id: null });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
