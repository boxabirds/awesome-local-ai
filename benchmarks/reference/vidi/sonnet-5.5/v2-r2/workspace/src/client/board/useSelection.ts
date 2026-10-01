import { useCallback, useState } from 'react';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/** Local selection and editing state; never stored in the document. */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<{ selectedId: string | null; editingId: string | null }>({
    selectedId: null,
    editingId: null,
  });

  const select = useCallback((id: string | null) => {
    setState((s) => ({ selectedId: id, editingId: s.editingId === id ? id : null }));
  }, []);
  const startEdit = useCallback((id: string) => setState({ selectedId: id, editingId: id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => ({ selectedId: next === 'selected' ? s.selectedId : null, editingId: null }));
  }, []);

  return { ...state, select, startEdit, endEdit };
}
