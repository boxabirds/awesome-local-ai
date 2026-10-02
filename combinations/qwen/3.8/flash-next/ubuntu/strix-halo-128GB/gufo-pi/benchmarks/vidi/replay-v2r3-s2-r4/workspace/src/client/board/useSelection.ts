import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface Selection {
  /** The note with the blue outline and toolbar, if any. */
  selectedId: string | null;
  /** The note whose text editor is open, if any. */
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

const NOTHING: SelectionState = { selectedId: null, editingId: null };

/**
 * Selection and editing are per-client interaction state and are never written
 * to the Y.Doc (story 3 must not sync "what I am looking at").
 */
export function useSelection(): Selection {
  const [state, setState] = useState<SelectionState>(NOTHING);

  const select = useCallback((id: string | null) => {
    setState((current) => ({
      selectedId: id,
      // Selecting another note (or nothing) closes any open editor.
      editingId: current.editingId === id ? current.editingId : null,
    }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setState((current) =>
      next === 'selected'
        ? { selectedId: current.editingId ?? current.selectedId, editingId: null }
        : NOTHING,
    );
  }, []);

  return {
    selectedId: state.selectedId,
    editingId: state.editingId,
    select,
    startEdit,
    endEdit,
  };
}
