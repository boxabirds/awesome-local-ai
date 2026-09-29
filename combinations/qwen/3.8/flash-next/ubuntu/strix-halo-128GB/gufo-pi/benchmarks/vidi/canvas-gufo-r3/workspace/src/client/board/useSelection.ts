import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

/**
 * Local, per-client selection and editing state.
 * Never written to the Y.Doc: other users must not see my selection as data
 * (selection presence is a later story).
 */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<{ selectedId: string | null; editingId: string | null }>({
    selectedId: null,
    editingId: null,
  });

  const select = useCallback((id: string | null) => {
    setState({ selectedId: id, editingId: null });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setState((s) => {
      if (s.editingId === null) return s;
      if (next === 'selected') return { selectedId: s.editingId, editingId: null };
      // Unselected: only drop the selection when it still points at the note we edited.
      // Clicking another note selects it first; that selection must survive.
      return { selectedId: s.selectedId === s.editingId ? null : s.selectedId, editingId: null };
    });
  }, []);

  return { selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit };
}
