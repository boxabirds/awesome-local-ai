import { useCallback, useState } from 'react';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

interface State { selectedId: string | null; editingId: string | null }

export function useSelection(): Selection {
  const [state, setState] = useState<State>({ selectedId: null, editingId: null });
  const select = useCallback((id: string | null) => {
    setState((s) => {
      const editingId = s.editingId === id ? id : null;
      return s.selectedId === id && s.editingId === editingId ? s : { selectedId: id, editingId };
    });
  }, []);
  const startEdit = useCallback((id: string) => setState({ selectedId: id, editingId: id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => ({ selectedId: next === 'selected' ? s.selectedId : null, editingId: null }));
  }, []);
  return { ...state, select, startEdit, endEdit };
}
