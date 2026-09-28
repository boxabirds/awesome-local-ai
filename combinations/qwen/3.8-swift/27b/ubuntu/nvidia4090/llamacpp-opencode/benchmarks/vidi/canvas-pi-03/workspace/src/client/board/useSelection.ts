import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from 'src/shared/board-model';

/**
 * Story 7: per-client multi-selection (sel.interaction).
 *
 * Local state only — the selection is NEVER written to the Y.Doc: other
 * users must not see my selection as data (sel.all_types; presence of
 * selections is a later story).
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

export const EMPTY_SELECTION: SelectionState = { ids: new Set(), editingId: null };

/**
 * Pure selection state machine:
 * - click      → exactly {id} (replaces the set, ends editing)
 * - toggle     → add / remove one id (Shift-click)
 * - setMany    → marquee / select-all (additive unions, non-additive replaces)
 * - clear      → empty (Escape / empty-space click / after delete)
 * - prune      → drop ids no longer on the board (remote delete); a pruned
 *                editingId ends editing
 * - edit       → start/end text editing of one object
 *
 * (Ids absent from the board are filtered by the hook before dispatch —
 * actions referring to absent ids are ignored.)
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: null };
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: state.editingId };
    }
    case 'setMany': {
      const ids = action.additive
        ? new Set([...state.ids, ...action.ids])
        : new Set(action.ids);
      return { ids, editingId: state.editingId };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId)
          ? state.editingId
          : null;
      return { ids, editingId };
    }
    case 'edit':
      if (action.id === null) return { ...state, editingId: null };
      return { ids: new Set([action.id]), editingId: action.id };
  }
}

export interface Selection {
  ids: ReadonlySet<string>;
  editingId: string | null;
  /** Click: make `id` the only selected object (no-op for absent ids). */
  click: (id: string) => void;
  /** Shift-click: add `id` if absent, remove it if selected (no-op for absent ids). */
  toggle: (id: string) => void;
  /** Marquee / select-all: `additive` unions with the current selection. */
  setMany: (ids: string[], additive: boolean) => void;
  /** Escape / empty-space click / after a group delete. */
  clear: () => void;
  startEdit: (id: string) => void;
  endEdit: (next: 'selected' | 'unselected') => void;
}

/**
 * Multi-selection for one client, pruned live from the board snapshot: when
 * a remote update deletes an object this client selected, it drops out of
 * the selection and the rest stay selected (sel.remote_delete).
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): Selection {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const present = new Set<string>(snapshot.map((o) => o.id));

  // Remote delete prunes the selection (and ends editing of a deleted note).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: present });
    // `present` is rebuilt every render; the effect runs on snapshot change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  const click = useCallback(
    (id: string) => {
      if (!present.has(id)) return; // absent id: ignored
      dispatch({ type: 'click', id });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot],
  );

  const toggle = useCallback(
    (id: string) => {
      if (!present.has(id)) return;
      dispatch({ type: 'toggle', id });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot],
  );

  const setMany = useCallback(
    (ids: string[], additive: boolean) => {
      dispatch({ type: 'setMany', ids: ids.filter((id) => present.has(id)), additive });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => {
    // No presence check: a just-created note is not in the current snapshot
    // yet (the doc write re-renders a tick later). A truly absent id is
    // pruned by the next snapshot pass.
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') dispatch({ type: 'clear' });
  }, []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
