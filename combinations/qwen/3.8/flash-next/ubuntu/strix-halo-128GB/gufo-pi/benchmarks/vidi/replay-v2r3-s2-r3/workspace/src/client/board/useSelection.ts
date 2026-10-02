import { useCallback, useState } from 'react';

export interface SelectionState {
  /** The note with the blue outline, or null. */
  selectedId: string | null;
  /** The note whose text editor is open, or null. */
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Per-client selection and editing state. This is deliberately *not* stored in
 * the Y.Doc: what I have selected is mine, and story 6 puts other people's
 * selections on the board without touching this.
 */
export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting another note closes the editor of the previous one
    setEditingId((previous) => (previous && previous !== id ? null : previous));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
