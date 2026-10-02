import { useCallback, useReducer } from 'react';

/**
 * Local interaction state (sticky.interaction): which note is selected and
 * which note is being edited. Never stored in the Y.Doc — selection and caret
 * position are per-client.
 */
export interface UseSelectionResult {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

interface State {
  selectedId: string | null;
  editingId: string | null;
}

type Action =
  | { type: 'select'; id: string | null }
  | { type: 'startEdit'; id: string }
  | { type: 'endEdit'; next: 'selected' | 'unselected' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'select': {
      if (state.selectedId === action.id && state.editingId === null) return state;
      return { selectedId: action.id, editingId: null };
    }
    case 'startEdit': {
      if (state.selectedId === action.id && state.editingId === action.id) return state;
      return { selectedId: action.id, editingId: action.id };
    }
    case 'endEdit': {
      const selectedId = action.next === 'selected' ? (state.editingId ?? state.selectedId) : null;
      if (state.editingId === null && state.selectedId === selectedId) return state;
      return { selectedId, editingId: null };
    }
    default:
      return state;
  }
}

export function useSelection(): UseSelectionResult {
  const [state, dispatch] = useReducer(reducer, { selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);
  const startEdit = useCallback((id: string) => dispatch({ type: 'startEdit', id }), []);
  const endEdit = useCallback(
    (next: 'selected' | 'unselected') => dispatch({ type: 'endEdit', next }),
    [],
  );

  return { selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit };
}
