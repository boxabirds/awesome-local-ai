import { useCallback, useState } from 'react';

/**
 * Per-client selection and editing state. This is intentionally NOT stored in
 * the Y.Doc: which note *you* have selected or are typing in is local to your
 * page (other people select independently in story 3).
 */
export interface Selection {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with null. */
  select(id: string | null): void;
  /** Make a note selected and editing. */
  startEdit(id: string): void;
  /** Stop editing; keep the note selected, or drop the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) setEditingId(null);
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
