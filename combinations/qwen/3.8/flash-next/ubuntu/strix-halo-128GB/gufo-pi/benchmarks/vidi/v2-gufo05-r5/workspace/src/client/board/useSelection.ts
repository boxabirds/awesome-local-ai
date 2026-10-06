/**
 * Multi-object selection state (story 7).
 *
 * Selection is per-user, per-tab: it is never written to the Y.Doc, so two people on
 * the same board do not steal each other's selection.
 *
 * The reducer is exported for unit testing; the hook wraps it with React state.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
}

export type SelectionAction =
  | { type: 'click'; id: string }
  | { type: 'toggle'; id: string }
  | { type: 'setMany'; ids: string[]; additive: boolean }
  | { type: 'clear' }
  | { type: 'prune'; presentIds: ReadonlySet<string> }
  | { type: 'edit'; id: string | null };

const EMPTY: SelectionState = { ids: new Set(), editingId: null };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: state.editingId === action.id ? state.editingId : null };

    case 'toggle': {
      const next = new Set(state.ids);
      if (next.has(action.id)) {
        next.delete(action.id);
        // if the removed id was being edited, end editing
        return { ids: next, editingId: state.editingId === action.id ? null : state.editingId };
      } else {
        next.add(action.id);
        return { ids: next, editingId: state.editingId };
      }
    }

    case 'setMany': {
      if (action.additive) {
        const next = new Set(state.ids);
        for (const id of action.ids) next.add(id);
        return { ids: next, editingId: state.editingId };
      }
      return { ids: new Set(action.ids), editingId: null };
    }

    case 'clear':
      return EMPTY;

    case 'prune': {
      const next = new Set<string>();
      for (const id of state.ids) {
        if (action.presentIds.has(id)) next.add(id);
      }
      const editingStillPresent = state.editingId !== null && action.presentIds.has(state.editingId);
      return { ids: next, editingId: editingStillPresent ? state.editingId : null };
    }

    case 'edit':
      return { ids: state.ids, editingId: action.id };

    default:
      return state;
  }
}

export interface SelectionController {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  click(id: string): void;
  toggle(id: string): void;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
  startEdit(id: string): void;
  endEdit(next?: EndEditNext): void;
}

/**
 * Multi-selection hook. The snapshot is watched for remote deletions: when an object
 * in the selection disappears from the doc, it is pruned from the selection.
 */
export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionController {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY);

  // Prune: when the snapshot changes, remove ids that no longer exist
  useEffect(() => {
    const presentIds = new Set(snapshot.map((obj) => obj.id));
    dispatch({ type: 'prune', presentIds });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    dispatch({ type: 'setMany', ids, additive });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'click', id });
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback((next?: EndEditNext) => {
    if (next === 'unselected') {
      dispatch({ type: 'clear' });
    } else {
      dispatch({ type: 'edit', id: null });
    }
  }, []);

  return useMemo(
    () => ({ ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit }),
    [state.ids, state.editingId, click, toggle, setMany, clear, startEdit, endEdit],
  );
}
