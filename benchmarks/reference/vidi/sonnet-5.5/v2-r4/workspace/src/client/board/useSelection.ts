import { useCallback, useState } from 'react';

interface State {
  selectedId: string | null;
  editingId: string | null;
}

/** Local selection and editing state; never stored in the document. */
export function useSelection() {
  const [state, setState] = useState<State>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState((s) => (s.selectedId === id && (id === null || s.editingId === null) ? s : { selectedId: id, editingId: id !== null && s.editingId === id ? id : null }));
  }, []);
  const startEdit = useCallback((id: string) => setState({ selectedId: id, editingId: id }), []);
  const endEdit = useCallback(
    (next: 'selected' | 'unselected') =>
      setState((s) => (next === 'selected' ? { selectedId: s.selectedId ?? s.editingId, editingId: null } : { selectedId: null, editingId: null })),
    [],
  );

  return { ...state, select, startEdit, endEdit };
}
