import { useCallback, useState } from 'react';

/** Which note is selected / being edited, plus the transitions between those states. */
export interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * The per-user selection and editing state.
 *
 * This lives entirely in React and is **never written to the Y.Doc**: what one person
 * has selected is private to their screen (presence and shared selection are later
 * stories). `endEdit('unselected')` also drops the selection — that is the "clicked
 * outside" path; `endEdit('selected')` is Escape, which keeps the note selected.
 */
export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    if (id === null) setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string): void => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected'): void => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
