import { useCallback, useMemo, useState } from 'react';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

/** Local selection and editing state. Never written to the board document. */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState((s) => (s.selectedId === id && s.editingId === null ? s : { selectedId: id, editingId: null }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => ({ selectedId: next === 'selected' ? s.selectedId : null, editingId: null }));
  }, []);

  return useMemo(
    () => ({ selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit }),
    [state, select, startEdit, endEdit],
  );
}
