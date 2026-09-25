/**
 * Local selection and editing state (anchor: sticky.interaction). Never written to the
 * Y.Doc: my selection is not board data that other people should receive.
 */
import { useCallback, useMemo, useState } from 'react';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

interface State {
  selectedId: string | null;
  editingId: string | null;
}

const NONE: State = { selectedId: null, editingId: null };

export function useSelection(): SelectionApi {
  const [state, setState] = useState<State>(NONE);

  const select = useCallback((id: string | null) => {
    setState((s) => {
      // Selecting the note being edited keeps editing; anything else ends it.
      const editingId = s.editingId !== null && s.editingId === id ? s.editingId : null;
      if (s.selectedId === id && s.editingId === editingId) return s;
      return { selectedId: id, editingId };
    });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((s) => (s.selectedId === id && s.editingId === id ? s : { selectedId: id, editingId: id }));
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((s) => {
      if (s.editingId === null) return next === 'unselected' && s.selectedId !== null ? NONE : s;
      return next === 'selected' ? { selectedId: s.editingId, editingId: null } : NONE;
    });
  }, []);

  return useMemo(
    () => ({ selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit }),
    [state, select, startEdit, endEdit],
  );
}
