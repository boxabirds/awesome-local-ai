import { useCallback, useState } from 'react';

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

/**
 * This client's selection and text-editing state. Deliberately local: it is never written to the Y.Doc,
 * so other people never see my selection as board data.
 */
export function useSelection(): {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
} {
  const [state, setState] = useState<SelectionState>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState((s) => {
      // Selecting the note being edited keeps editing; selecting anything else ends it.
      const editingId = s.editingId !== null && s.editingId === id ? s.editingId : null;
      return s.selectedId === id && s.editingId === editingId ? s : { selectedId: id, editingId };
    });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((s) => (s.selectedId === id && s.editingId === id ? s : { selectedId: id, editingId: id }));
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => {
      if (s.editingId === null) return s;
      return { selectedId: next === 'selected' ? s.editingId : null, editingId: null };
    });
  }, []);

  return { ...state, select, startEdit, endEdit };
}
