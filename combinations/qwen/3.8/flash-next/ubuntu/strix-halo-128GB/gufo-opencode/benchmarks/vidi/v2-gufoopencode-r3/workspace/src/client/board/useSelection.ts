import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

// Pure reducer state. `presentIds` mirrors the object ids currently in the
// document so actions for stale ids (races with remote deletes) can be
// ignored without touching component code.
export interface SelectionReducerState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  readonly presentIds: ReadonlySet<string>;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; present: readonly string[] }
  | { type: 'edit'; id: string }
  | { type: 'endEdit'; next: EndEditNext };

export function initialSelectionState(
  present: readonly string[] = []
): SelectionReducerState {
  return { ids: new Set(), editingId: null, presentIds: new Set(present) };
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

// Actions for ids absent from presentIds are ignored — except `edit`, which
// createSticky + startEdit dispatch in the same tick, before the prune effect
// has seen the new id (see NOTES.md).
export function selectionReducer(
  state: SelectionReducerState,
  action: SelectionAction
): SelectionReducerState {
  switch (action.type) {
    case 'click': {
      if (!state.presentIds.has(action.id)) return state;
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) {
        return state;
      }
      return { ...state, ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      if (!state.presentIds.has(action.id)) return state;
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId =
        state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId;
      return { ...state, ids, editingId };
    }
    case 'setMany': {
      const incoming = action.ids.filter((id) => state.presentIds.has(id));
      // A batch whose ids are all gone (stale marquee/select-all racing a
      // remote delete) is ignored; partial batches apply with survivors.
      if (incoming.length === 0 && action.ids.length > 0) return state;
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of incoming) ids.add(id);
      if (sameIds(ids, state.ids)) return state;
      const editingId =
        state.editingId !== null && !ids.has(state.editingId) ? null : state.editingId;
      return { ...state, ids, editingId };
    }
    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ...state, ids: new Set(), editingId: null };
    }
    case 'prune': {
      const present = new Set(action.present);
      const ids = new Set<string>();
      for (const id of state.ids) if (present.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && !present.has(state.editingId) ? null : state.editingId;
      const unchanged =
        sameIds(ids, state.ids) &&
        editingId === state.editingId &&
        sameIds(present, state.presentIds);
      if (unchanged) return state;
      return { ids, editingId, presentIds: present };
    }
    case 'edit': {
      if (state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id)) {
        return state;
      }
      return { ...state, ids: new Set([action.id]), editingId: action.id };
    }
    case 'endEdit': {
      if (state.editingId === null) return state;
      if (action.next === 'unselected') {
        return { ...state, editingId: null, ids: new Set() };
      }
      return { ...state, editingId: null };
    }
  }
}

export interface SelectionController {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

// Multi-selection state for one client. Never written to the Y.Doc. The prune
// effect removes ids deleted by other people (TC-35/TC-16) and ends editing
// when the edited object goes away.
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionController {
  const [state, dispatch] = useReducer(
    selectionReducer,
    snapshot,
    (initial) => initialSelectionState(initial.map((o) => o.id))
  );

  useEffect(() => {
    dispatch({ type: 'prune', present: snapshot.map((o) => o.id) });
  }, [snapshot]);

  const click = useCallback((id: string) => dispatch({ type: 'click', id }), []);
  const toggle = useCallback((id: string) => dispatch({ type: 'toggle', id }), []);
  const setMany = useCallback(
    (ids: readonly string[], additive: boolean) => dispatch({ type: 'setMany', ids, additive }),
    []
  );
  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'edit', id }), []);
  const endEdit = useCallback((next: EndEditNext) => dispatch({ type: 'endEdit', next }), []);

  return useMemo(
    () => ({
      ids: state.ids,
      editingId: state.editingId,
      click,
      toggle,
      setMany,
      clear,
      startEdit,
      endEdit
    }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit]
  );
}
