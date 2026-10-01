import { useCallback, useState } from 'react';

interface State {
  selectedId: string | null;
  editingId: string | null;
}

export function useSelection() {
  const [state, setState] = useState<State>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState((s) => {
      if (s.selectedId === id) return s;
      return { selectedId: id, editingId: null };
    });
  }, []);
  const startEdit = useCallback((id: string) => setState({ selectedId: id, editingId: id }), []);
  const endEdit = useCallback(
    (next: 'selected' | 'unselected') =>
      setState((s) => ({ selectedId: next === 'selected' ? s.selectedId : null, editingId: null })),
    [],
  );
  return { ...state, select, startEdit, endEdit };
}
