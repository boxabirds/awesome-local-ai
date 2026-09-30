import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface UseSelectionResult {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

/**
 * Local per-client selection and editing state. Never written to the Y.Doc:
 * every person on a shared board (story 3) selects different notes.
 */
export function useSelection(): UseSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId((prev) => (prev === id ? prev : id));
    setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
