import { useCallback, useMemo, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Selects one note (or clears with null); always ends text editing. */
  select(id: string | null): void;
  /** Selects the note and starts editing its text. */
  startEdit(id: string): void;
  /** Stops editing; the note stays selected or the selection is cleared. */
  endEdit(next: EndEditNext): void;
}

interface State {
  selectedId: string | null;
  editingId: string | null;
}

const NONE: State = { selectedId: null, editingId: null };

/**
 * This viewer's selection and editing state. Local component state only: it is never
 * written to the board document, so other people never see it as data.
 */
export function useSelection(): Selection {
  const [state, setState] = useState<State>(NONE);

  const select = useCallback((id: string | null) => {
    setState((s) => (s.selectedId === id && s.editingId === null ? s : { selectedId: id, editingId: null }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((s) => (s.selectedId === id && s.editingId === id ? s : { selectedId: id, editingId: id }));
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
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
