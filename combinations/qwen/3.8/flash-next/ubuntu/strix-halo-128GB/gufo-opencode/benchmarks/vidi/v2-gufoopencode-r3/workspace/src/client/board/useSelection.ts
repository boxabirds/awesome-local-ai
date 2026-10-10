import { useCallback, useReducer } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  // Local-only drag flag (used to hide the note toolbar while dragging).
  // Never written to the Y.Doc.
  readonly draggingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
  setDragging(id: string | null): void;
}

type Action =
  | { type: 'select'; id: string | null }
  | { type: 'startEdit'; id: string }
  | { type: 'endEdit'; next: EndEditNext }
  | { type: 'dragging'; id: string | null };

interface State {
  selectedId: string | null;
  editingId: string | null;
  draggingId: string | null;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'select':
      if (state.selectedId === action.id && state.editingId === null) return state;
      return { ...state, selectedId: action.id, editingId: null };
    case 'startEdit':
      if (state.selectedId === action.id && state.editingId === action.id) return state;
      return { ...state, selectedId: action.id, editingId: action.id };
    case 'endEdit':
      // Guard against stray blur/unmount paths after editing already ended.
      if (state.editingId === null) return state;
      if (action.next === 'unselected') {
        return { ...state, editingId: null, selectedId: null };
      }
      return { ...state, editingId: null };
    case 'dragging':
      if (state.draggingId === action.id) return state;
      return { ...state, draggingId: action.id };
  }
}

// Selection and editing are per-client state and never stored in the document.
export function useSelection(): SelectionState {
  const [state, dispatch] = useReducer(reducer, {
    selectedId: null,
    editingId: null,
    draggingId: null
  });

  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'startEdit', id }), []);
  const endEdit = useCallback((next: EndEditNext) => dispatch({ type: 'endEdit', next }), []);
  const setDragging = useCallback((id: string | null) => dispatch({ type: 'dragging', id }), []);

  return {
    selectedId: state.selectedId,
    editingId: state.editingId,
    draggingId: state.draggingId,
    select,
    startEdit,
    endEdit,
    setDragging
  };
}
