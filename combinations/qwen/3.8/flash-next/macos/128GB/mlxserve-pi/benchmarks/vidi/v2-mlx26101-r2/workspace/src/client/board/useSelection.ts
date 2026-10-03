import { useCallback, useMemo, useReducer } from 'react';

/** Where editing leaves the note. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  /** The note with the blue outline and the note toolbar, if any. */
  selectedId: string | null;
  /** The note whose textarea is open, if any. */
  editingId: string | null;
  /** Select a note, or clear the selection with `null`. */
  select(id: string | null): void;
  /** Open a note's text editor (implies selecting it). */
  startEdit(id: string): void;
  /** Close the text editor, keeping or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

interface State {
  selectedId: string | null;
  editingId: string | null;
}

type Action =
  | { type: 'select'; id: string | null }
  | { type: 'startEdit'; id: string }
  | { type: 'endEdit'; next: EndEditNext };

/**
 * Which note is selected and which note is being edited, for this client only.
 *
 * This is deliberately *local* state and never written to the Y.Doc: what one
 * person has selected is not board content, and once the document is shared
 * (story 3) writing it there would move other people's selection.
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'select': {
      // Selecting a different note closes an open editor: only one note is ever
      // in edit mode, and the text typed so far is already in the document.
      if (state.selectedId === action.id && state.editingId === null) return state;
      const editingGone = action.id !== state.editingId;
      return {
        selectedId: action.id,
        editingId: editingGone ? null : state.editingId,
      };
    }
    case 'startEdit':
      if (state.editingId === action.id && state.selectedId === action.id) return state;
      return { selectedId: action.id, editingId: action.id };
    case 'endEdit': {
      if (state.editingId === null) return state;
      const edited = state.editingId;
      return {
        selectedId: action.next === 'selected' ? edited : null,
        editingId: null,
      };
    }
  }
}

export function useSelection(): SelectionState {
  const [state, dispatch] = useReducer(reducer, { selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    dispatch({ type: 'select', id });
  }, []);

  const startEdit = useCallback((id: string) => {
    dispatch({ type: 'startEdit', id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    dispatch({ type: 'endEdit', next });
  }, []);

  return useMemo<SelectionState>(
    () => ({
      selectedId: state.selectedId,
      editingId: state.editingId,
      select,
      startEdit,
      endEdit,
    }),
    [state.selectedId, state.editingId, select, startEdit, endEdit],
  );
}
