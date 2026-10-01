import { useCallback, useEffect, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

/** Immutable selection state. */
export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

/** Actions dispatched to the selection reducer. */
export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: readonly string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const INITIAL_STATE: SelectionState = { ids: new Set(), editingId: null };

/**
 * Pure selection reducer. No side effects, no doc access.
 * - click: replaces selection with {id}
 * - toggle: adds id if not present, removes if present
 * - setMany: replaces (non-additive) or merges (additive) with ids
 * - clear: empties selection and editing
 * - prune: removes ids not in presentIds (used after snapshot change)
 * - edit: sets or clears editingId
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click': {
      return { ids: new Set([action.id]), editingId: null };
    }
    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ids: next, editingId: state.editingId };
    }
    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      } else {
        return { ids: new Set(action.ids), editingId: null };
      }
    }
    case 'clear': {
      return INITIAL_STATE;
    }
    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingId = state.editingId !== null && action.presentIds.has(state.editingId)
        ? state.editingId
        : null;
      // If selection is now empty but was not, also clear editing
      if (next.size === 0 && state.ids.size > 0) {
        return INITIAL_STATE;
      }
      return { ids: next, editingId };
    }
    case 'edit': {
      return { ids: state.ids, editingId: action.id };
    }
    default:
      return state;
  }
}

/** API returned by useSelection hook. */
export interface SelectionApi {
  /** Set of currently selected object ids. */
  ids: ReadonlySet<string>;
  /** Id of the object whose text editor is open, or null. */
  editingId: string | null;
  /** Click on an object: replaces selection with just that object. */
  click(id: string): void;
  /** Shift-click: toggle one object in/out of selection. */
  toggle(id: string): void;
  /** Set many ids at once (marquee, select all). additive=true merges. */
  setMany(ids: readonly string[], additive: boolean): void;
  /** Clear all selection. */
  clear(): void;
  /** Open the text editor on an object (also selects it). */
  startEdit(id: string): void;
  /** Close the editor. 'unselected' also deselects. */
  endEdit(next: EndEditNext): void;
}

/**
 * Which objects are selected and which is being edited. This is per-client
 * interaction state: two people looking at the same board select different
 * objects, so it is deliberately never written to the shared Y.Doc.
 *
 * Passes the current snapshot so the reducer can prune ids that have been
 * remotely deleted.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, INITIAL_STATE);

  // Prune ids that are no longer in the snapshot (remote deletes).
  const presentKey = snapshot.map((o) => o.id).join(',');
  useEffect(() => {
    const presentIds = new Set(snapshot.map((o) => o.id));
    dispatch({ type: 'prune', presentIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentKey]);

  const click = useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: readonly string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    dispatch({ type: 'edit', id: null });
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    }
  }, []);

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
