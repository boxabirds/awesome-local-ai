import { useCallback, useMemo, useState } from 'react';

interface State { selectedId: string | null; editingId: string | null }

export interface SelectionApi extends State {
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/** Local, per-client selection and editing state; never stored in the document. */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<State>({ selectedId: null, editingId: null });
  const select = useCallback((id: string | null) => {
    setState((s) => {
      const editingId = s.editingId === id ? id : null;
      return s.selectedId === id && s.editingId === editingId ? s : { selectedId: id, editingId };
    });
  }, []);
  const startEdit = useCallback((id: string) => setState({ selectedId: id, editingId: id }), []);
  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => (next === 'selected'
      ? { selectedId: s.selectedId, editingId: null }
      : { selectedId: null, editingId: null }));
  }, []);
  return useMemo(() => ({ ...state, select, startEdit, endEdit }), [state, select, startEdit, endEdit]);
}
