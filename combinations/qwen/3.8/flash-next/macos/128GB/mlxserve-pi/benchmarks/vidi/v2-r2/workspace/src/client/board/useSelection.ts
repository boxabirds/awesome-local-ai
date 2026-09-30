// Which note the user has selected and which one they are typing in. This is
// per-client interaction state: it is never written to the Y.Doc, because two
// people on the same board (story 3) select different things.
//
// selectedId: null | id, editingId: null | id (always a selected note).
//   select(id)          select, and stop editing anything else
//   select(null)        clear both
//   startEdit(id)       select and edit
//   endEdit('selected') stop editing, keep the selection   (Escape)
//   endEdit('unselected') stop editing and deselect        (click outside)

import { useCallback, useMemo, useReducer } from 'react';

/** What is selected once editing stops. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
}

type Action =
  | { type: 'select'; id: string | null }
  | { type: 'startEdit'; id: string }
  | { type: 'endEdit'; next: EndEditNext };

function reducer(state: SelectionState, action: Action): SelectionState {
  switch (action.type) {
    case 'select':
      if (state.selectedId === action.id && state.editingId === null) return state;
      return { selectedId: action.id, editingId: null };
    case 'startEdit':
      if (state.editingId === action.id) return state;
      return { selectedId: action.id, editingId: action.id };
    case 'endEdit':
      if (state.editingId === null) return state;
      return action.next === 'selected'
        ? { selectedId: state.selectedId, editingId: null }
        : { selectedId: null, editingId: null };
  }
}

export function useSelection(): SelectionApi {
  const [state, dispatch] = useReducer(reducer, { selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'startEdit', id }), []);
  const endEdit = useCallback((next: EndEditNext) => dispatch({ type: 'endEdit', next }), []);

  return useMemo<SelectionApi>(
    () => ({ selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit }),
    [state.selectedId, state.editingId, select, startEdit, endEdit],
  );
}
