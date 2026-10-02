/**
 * Multi-selection state (story 7).
 *
 * Selection is one set of ids plus the id whose text editor is open. The
 * reducer is exported on its own so the whole selection rule table can be
 * tested without a component; the hook adds the parts that need the document:
 * commands ignore ids that are not on the board, and objects deleted by somebody
 * else leave the selection on their own.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionState {
  ids: ReadonlySet<string>;
  /** The object whose text editor is open, or null. */
  editingId: string | null;
}

export const NO_IDS: ReadonlySet<string> = new Set<string>();

export const initialSelectionState: SelectionState = { ids: NO_IDS, editingId: null };

export type SelectionAction =
  /** Plain click or tap: this object only. */
  | { type: 'click'; id: string }
  /** Shift+click: add or remove one object. */
  | { type: 'toggle'; id: string }
  /** Marquee (additive) or select-all (replacing). */
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  /** Open the text editor of one object. */
  | { type: 'edit'; id: string }
  | { type: 'endEdit'; next?: 'selected' | 'unselected' }
  /** Drop ids that are no longer on the board. */
  | { type: 'prune'; presentIds: ReadonlySet<string> };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Editing survives only while the edited object is still selected. */
function editingStillSelected(ids: ReadonlySet<string>, editingId: string | null): string | null {
  return editingId !== null && ids.has(editingId) ? editingId : null;
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      if (state.ids.size === 1 && state.ids.has(action.id) && state.editingId === null) return state;
      return { ids: new Set([action.id]), editingId: null };
    }

    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      const editingId = editingStillSelected(ids, state.editingId);
      if (sameIds(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }

    case 'setMany': {
      const ids = action.additive ? new Set(state.ids) : new Set<string>();
      for (const id of action.ids) ids.add(id);
      const editingId = editingStillSelected(ids, state.editingId);
      if (sameIds(ids, state.ids) && editingId === state.editingId) return state;
      return { ids, editingId };
    }

    case 'clear': {
      if (state.ids.size === 0 && state.editingId === null) return state;
      return { ids: NO_IDS, editingId: null };
    }

    case 'edit': {
      const editing = state.editingId === action.id && state.ids.size === 1 && state.ids.has(action.id);
      if (editing) return state;
      return { ids: new Set([action.id]), editingId: action.id };
    }

    case 'endEdit': {
      if (action.next === 'unselected') {
        if (state.ids.size === 0 && state.editingId === null) return state;
        return { ids: NO_IDS, editingId: null };
      }
      if (state.editingId === null) return state;
      return { ids: state.ids, editingId: null };
    }

    case 'prune': {
      const ids = new Set<string>();
      for (const id of state.ids) if (action.presentIds.has(id)) ids.add(id);
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      if (ids.size === state.ids.size && sameIds(ids, state.ids) && editingId === state.editingId) {
        return state;
      }
      return { ids: ids.size === 0 ? NO_IDS : ids, editingId };
    }

    default:
      return state;
  }
}

export interface UseSelectionResult extends SelectionState {
  /** Plain click or tap: one object, gesture ready. */
  click(id: string): void;
  /** Shift+click. */
  toggle(id: string): void;
  /** Marquee (additive) or select-all (replacing). */
  setMany(ids: readonly string[], additive?: boolean): void;
  clear(): void;
  /** Open the text editor of one object. */
  startEdit(id: string): void;
  /** Close the editor; 'unselected' also clears the selection. */
  endEdit(next?: 'selected' | 'unselected'): void;
  has(id: string): boolean;
}

/**
 * The board's selection. `snapshot` is the current object list; ids that vanish
 * from it (a remote delete) are dropped and editing ends if the edited object
 * goes away.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): UseSelectionResult {
  const [state, dispatch] = useReducer(selectionReducer, undefined, () => initialSelectionState);

  const presentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of snapshot) if (obj && typeof obj.id === 'string') ids.add(obj.id);
    return ids;
  }, [snapshot]);

  // What the rest of the app sees is always the selection restricted to the
  // objects that exist. The stored state is tidied up right afterwards.
  const visible = useMemo(
    () => selectionReducer(state, { type: 'prune', presentIds }),
    [state, presentIds],
  );

  const lastPrune = useRef(presentIds);
  useEffect(() => {
    if (lastPrune.current === presentIds) return;
    lastPrune.current = presentIds;
    dispatch({ type: 'prune', presentIds });
  }, [presentIds]);

  const click = useCallback((id: string) => {
    if (!presentIds.has(id)) return;
    dispatch({ type: 'click', id });
  }, [presentIds]);

  const toggle = useCallback((id: string) => {
    if (!presentIds.has(id)) return;
    dispatch({ type: 'toggle', id });
  }, [presentIds]);

  const setMany = useCallback(
    (ids: readonly string[], additive = false) => {
      const known = ids.filter((id) => presentIds.has(id));
      if (!additive && known.length === 0) {
        dispatch({ type: 'clear' });
        return;
      }
      dispatch({ type: 'setMany', ids: known, additive });
    },
    [presentIds],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  // No presence guard here: a note created in the same tick as this call is not
  // in the snapshot yet, and it must open for typing. An id that never appears
  // is dropped by the pruning below instead.
  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next?: 'selected' | 'unselected') => {
    dispatch({ type: 'endEdit', next });
  }, []);

  const has = useCallback((id: string) => visible.ids.has(id), [visible.ids]);

  return {
    ids: visible.ids,
    editingId: visible.editingId,
    click,
    toggle,
    setMany,
    clear,
    startEdit,
    endEdit,
    has,
  };
}
