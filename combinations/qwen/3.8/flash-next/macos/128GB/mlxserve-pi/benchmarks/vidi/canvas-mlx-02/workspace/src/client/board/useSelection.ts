// Local per-client selection + editing state (story 2, multi-object in story 7).
// NEVER stored in the Y.Doc — other users must not see my selection as data
// (presence is a later story). Story 7: the selection is a Set of ids owned by
// the local client; the object itself is never aware of it beyond a prop.
//
// `selectionReducer` is exported separately so the interaction rule table
// (TC-13 to TC-15) is testable without rendering; the hook adds the live
// "actions referring to absent ids are ignored" part, which needs the doc.
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model.ts';

// Kept for the sticky editor's end-of-edit callback (story 7 keeps selection
// on end; deselecting goes through clear()/click()).
export type EndMode = 'selected' | 'unselected';

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

export const emptySelection: SelectionState = { ids: new Set<string>(), editingId: null };

// The rule table from the design:
//   {} -> click a -> {a}          (click selects only, replacing the Set)
//   {a} -> shift-click b -> {a,b} (toggle adds)
//   {a,b} -> click b -> {b}       (plain click replaces)
//   {a} -> shift-click a -> {}    (toggling the last member empties it)
// Editing is held by at most one object and ends whenever that object leaves
// the selection by any route (click away, toggle out, prune, clear).
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      return { ids: new Set([action.id]), editingId: action.id === state.editingId ? state.editingId : null };
    }
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = ids.has(state.editingId ?? '') ? state.editingId : null;
      return { ids, editingId };
    }
    case 'setMany': {
      if (!action.additive && action.ids.length === 0) return state; // selects nothing, nothing happens
      const ids = action.additive ? new Set([...state.ids, ...action.ids]) : new Set(action.ids);
      const editingId = ids.has(state.editingId ?? '') ? state.editingId : null;
      return { ids, editingId };
    }
    case 'clear':
      return state.ids.size === 0 && state.editingId === null ? state : { ids: new Set(), editingId: null };
    case 'prune': {
      const present: string[] = [];
      for (const id of state.ids) if (action.presentIds.has(id)) present.push(id);
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (present.length === state.ids.size && editingId === state.editingId) return state; // no-op
      return { ids: new Set(present), editingId };
    }
    case 'edit': {
      if (action.id === null) return { ...state, editingId: null };
      // Entering the edit selects only the edited object (story 2 behaviour).
      return { ids: new Set([action.id]), editingId: action.id };
    }
    default:
      return state;
  }
}

export interface SelectionApi {
  /** the selected ids; empty when nothing is selected */
  ids: ReadonlySet<string>;
  count: number;
  editingId: string | null;
  /** plain click: select only this object (ends any edit of another) */
  click(id: string): void;
  /** shift-click: add or remove from the Set */
  toggle(id: string): void;
  /** marquee / select-all: additive adds, non-additive replaces */
  setMany(ids: readonly string[], additive: boolean): void;
  /** click empty space (or the only way the selection becomes empty) */
  clear(): void;
  /** double-click a resizable... any editable object: enter its editor */
  startEdit(id: string): void;
  /** leave the editor, keep the selection */
  endEdit(): void;
}

// Selection state, kept in sync with the doc through prune: whenever the
// snapshot changes, a dispatch removes every selected id that no longer
// exists (TC-15/TC-16: selection survives the deletion of others). The hook
// additionally ignores actions naming ids absent from the snapshot, and the
// exposed Set is a live view of the selection (so a remote delete hides the
// bar in the same frame, without waiting for the effect).
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, emptySelection);

  const live = useMemo(() => {
    const set = new Set<string>();
    for (const obj of snapshot ?? []) set.add(obj.id);
    return set;
  }, [snapshot]);

  // Prune the stale selection as soon as the snapshot changes (the reducer
  // returns the identical state when nothing is stale, so no extra render).
  useEffect(() => {
    dispatch({ type: 'prune', presentIds: live });
  }, [live]);

  const ids = useMemo(() => {
    let stale = false;
    const out = new Set<string>();
    for (const id of state.ids) {
      if (live.has(id)) out.add(id);
      else stale = true;
    }
    return stale ? (out.size === 0 ? emptySelection.ids : out) : state.ids;
  }, [state.ids, live]);

  const editingId = state.editingId !== null && live.has(state.editingId) ? state.editingId : null;

  const guard = useCallback(
    (id: string): boolean => live.has(id),
    [live],
  );

  const click = useCallback(
    (id: string) => {
      if (!guard(id)) return; // unknown id: ignored
      dispatch({ type: 'click', id });
    },
    [guard],
  );

  const toggle = useCallback(
    (id: string) => {
      if (!guard(id)) return;
      dispatch({ type: 'toggle', id });
    },
    [guard],
  );

  const setMany = useCallback((next: readonly string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids: next.filter((id) => live.has(id)), additive });
  }, [live]);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback(
    (id: string) => {
      if (!guard(id)) return;
      dispatch({ type: 'edit', id });
    },
    [guard],
  );

  const endEdit = useCallback(() => {
    dispatch({ type: 'edit', id: null });
  }, []);

  return { ids, count: ids.size, editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
