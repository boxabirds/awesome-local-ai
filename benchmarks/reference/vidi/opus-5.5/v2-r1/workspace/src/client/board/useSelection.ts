import { useCallback, useState } from 'react';

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

export interface Selection extends SelectionState {
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

const NONE: SelectionState = { selectedId: null, editingId: null };

/** Local selection and editing state. Never stored in the board document. */
export function useSelection(): Selection {
  const [state, setState] = useState<SelectionState>(NONE);

  const select = useCallback((id: string | null) => {
    setState((s) => {
      // Re-selecting the note being edited keeps editing it.
      const editingId = id !== null && s.editingId === id ? id : null;
      return s.selectedId === id && s.editingId === editingId ? s : { selectedId: id, editingId };
    });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((s) =>
      s.selectedId === id && s.editingId === id ? s : { selectedId: id, editingId: id },
    );
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => {
      if (next === 'unselected') return s === NONE ? s : NONE;
      return { selectedId: s.editingId ?? s.selectedId, editingId: null };
    });
  }, []);

  return { ...state, select, startEdit, endEdit };
}
