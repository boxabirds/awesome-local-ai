import { useCallback, useMemo, useState } from 'react';

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

/** Local selection and editing state. Never written to the board document. */
export function useSelection(): {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
} {
  const [state, setState] = useState<SelectionState>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState((s) => (s.selectedId === id && s.editingId === null ? s : { selectedId: id, editingId: null }));
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

  return useMemo(
    () => ({ selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit }),
    [state, select, startEdit, endEdit],
  );
}
