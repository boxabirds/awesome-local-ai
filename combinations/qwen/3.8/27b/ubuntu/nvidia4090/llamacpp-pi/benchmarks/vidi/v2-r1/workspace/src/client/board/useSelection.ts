// useSelection (story 2, reworked for story 7): per-client selection and
// editing state as a set of object ids (multi-selection). Selection and
// editing are local UI state — never stored in the Y.Doc.
//
// The state machine is a pure reducer (`selectionReducer`) so it can be unit
// tested without React; `useSelection` drives it from a live object snapshot
// (a snapshot change dispatches `prune`, so objects deleted by another
// person drop out of the selection — sel.remote_delete).

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * One client's selection state. `present` is the id set from the most recent
 * snapshot: `click`/`toggle`/`setMany` ignore ids outside it (only `prune`
 * changes it), while `edit` may reference a not-yet-present id (a note
 * created in the same tick) — `prune` reconciles that later.
 */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  readonly present: ReadonlySet<string>;
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
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Build the initial state for a set of present ids (nothing selected). */
export function createSelectionState(presentIds: readonly string[]): SelectionState {
  return { ids: new Set<string>(), editingId: null, present: new Set(presentIds) };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (!state.present.has(action.id)) return state; // absent id → ignored
      if (state.ids.size === 1 && state.ids.has(action.id)) return state;
      return { ...state, ids: new Set([action.id]) };
    }
    case 'toggle': {
      if (!state.present.has(action.id)) return state; // absent id → ignored
      const next = new Set(state.ids);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, ids: next };
    }
    case 'setMany': {
      const valid = action.ids.filter((id) => state.present.has(id));
      if (action.additive) {
        let changed = false;
        const next = new Set(state.ids);
        for (const id of valid) {
          if (!next.has(id)) {
            next.add(id);
            changed = true;
          }
        }
        return changed ? { ...state, ids: next } : state;
      }
      const next = new Set(valid);
      if (sameSet(next, state.ids)) return state;
      return { ...state, ids: next };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ...state, ids: new Set<string>(), editingId: null };
    }
    case 'prune': {
      let idsChanged = false;
      const nextIds = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) nextIds.add(id);
        else idsChanged = true;
      }
      const editingId =
        state.editingId !== null && !action.presentIds.has(state.editingId)
          ? null
          : state.editingId;
      if (
        !idsChanged &&
        editingId === state.editingId &&
        sameSet(action.presentIds, state.present)
      ) {
        return state;
      }
      return { ids: nextIds, editingId, present: action.presentIds };
    }
    case 'edit': {
      if (action.id === null) {
        return state.editingId === null ? state : { ...state, editingId: null };
      }
      // Unlike click/toggle, `edit` does NOT require the id to be present in
      // the snapshot: a just-created note is edited in the same tick in which
      // it enters the document, before any snapshot render. If the id never
      // materialises (or is later deleted), `prune` drops it from `ids` and
      // clears `editingId`. Editing coexists with the selection (a note can
      // be edited while a group is selected); the edited object itself is
      // always selected.
      const ids = state.ids.has(action.id) ? state.ids : new Set([...state.ids, action.id]);
      if (state.editingId === action.id && ids === state.ids) return state;
      return { ...state, ids, editingId: action.id };
    }
  }
}

/** The imperative selection API exposed by `useSelection`. */
export interface SelectionApi {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Select only `id` (click). */
  click(id: string): void;
  /** Add or remove `id` (shift-click). */
  toggle(id: string): void;
  /** Replace the selection, or add to it when `additive` (marquee, select all). */
  setMany(ids: string[], additive: boolean): void;
  /** Clear the selection and end editing (empty-space click, Escape). */
  clear(): void;
  /** Start editing `id` (also selects it). */
  startEdit(id: string): void;
  /** End editing, keeping the selection (Escape in the editor). */
  endEdit(): void;
}

/**
 * Multi-selection bound to a live object snapshot. When the set of present
 * ids changes (objects created or deleted, locally or remotely) a `prune`
 * action drops absent ids from the selection and ends editing when the
 * edited object disappears.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, snapshot, (snap) =>
    createSelectionState(snap.map((o) => o.id)),
  );

  // Prune on snapshot changes (the snapshot array identity changes on every
  // document change; only the id set matters).
  const presentKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const ids = snapshot.map((o) => o.id);
    const key = ids.join('\u0000');
    if (presentKeyRef.current === null) {
      presentKeyRef.current = key;
      return;
    }
    if (key === presentKeyRef.current) return;
    presentKeyRef.current = key;
    dispatch({ type: 'prune', presentIds: new Set(ids) });
  }, [snapshot]);

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
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
  };
}
