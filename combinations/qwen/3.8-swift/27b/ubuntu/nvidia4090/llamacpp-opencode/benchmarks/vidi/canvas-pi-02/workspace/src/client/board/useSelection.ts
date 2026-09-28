// Local per-client selection + editing state (story 7, sel.interaction).
// Never written to the Y.Doc: other users must not see my selection
// (presence is story 6).
//
// `selectionReducer` is a pure function (unit-tested, TC-13 to TC-15); the
// hook prunes ids that vanished from the document (deletion, remote sync)
// and guards every mutation against missing ids.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

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

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'click':
      return { ids: new Set([action.id]), editingId: state.editingId };
    case 'toggle': {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ids, editingId: state.editingId };
    }
    case 'setMany': {
      const ids = new Set(action.additive ? state.ids : []);
      for (const id of action.ids) ids.add(id);
      return { ids, editingId: state.editingId };
    }
    case 'clear':
      return { ids: new Set(), editingId: null };
    case 'prune': {
      const ids = new Set([...state.ids].filter((id) => action.presentIds.has(id)));
      const editingId =
        state.editingId !== null && action.presentIds.has(state.editingId) ? state.editingId : null;
      return { ids, editingId };
    }
    case 'edit':
      // Entering editing selects exactly this object; leaving editing keeps
      // the selection (ids unchanged when the id is null).
      return {
        ids: action.id === null ? state.ids : new Set([action.id]),
        editingId: action.id,
      };
  }
}

export interface SelectionApi {
  readonly ids: ReadonlySet<string>;
  readonly editingId: string | null;
  /** Select exactly this object (plain click). */
  click(id: string): void;
  /** Add/remove this object (Shift+click). */
  toggle(id: string): void;
  /** Set the selection to `ids` (select-all) or add them (marquee). */
  setMany(ids: string[], additive: boolean): void;
  /** Clear the selection and end editing (Escape / empty click). */
  clear(): void;
  /** Select exactly this object and enter editing (double-click, Enter). */
  startEdit(id: string): void;
  /** Leave editing (Escape / blur in the editor); the selection is kept. */
  endEdit(): void;
}

const emptyState: SelectionState = { ids: new Set(), editingId: null };

export function useSelection(snapshot: readonly ObjectSnapshot[]): SelectionApi {
  const [state, dispatch] = useReducer(selectionReducer, emptyState);

  // The snapshot arrives fresh on every document change; prune the selection
  // and end editing for ids that no longer exist (remote deletion, etc.).
  const presentRef = useRef<ReadonlySet<string>>(new Set());
  presentRef.current = new Set(snapshot.map((o) => o.id));

  useEffect(() => {
    dispatch({ type: 'prune', presentIds: presentRef.current });
  }, [snapshot]);

  const click = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'click', id });
  }, []);

  const toggle = useCallback((id: string) => {
    if (presentRef.current.has(id)) dispatch({ type: 'toggle', id });
  }, []);

  const setMany = useCallback((ids: string[], additive: boolean) => {
    const present = ids.filter((id) => presentRef.current.has(id));
    if (present.length > 0 || !additive) dispatch({ type: 'setMany', ids: present, additive });
  }, []);

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);

  const startEdit = useCallback((id: string) => {
    // No present-id guard: the caller created the object (or double-clicked
    // a rendered one) in the same tick, so the snapshot this render saw does
    // not contain it yet. The prune effect cleans up if it disappears.
    dispatch({ type: 'edit', id });
  }, []);

  const endEdit = useCallback(() => dispatch({ type: 'edit', id: null }), []);

  return { ids: state.ids, editingId: state.editingId, click, toggle, setMany, clear, startEdit, endEdit };
}
