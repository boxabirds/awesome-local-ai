import { useCallback, useState } from 'react';

export interface UseSelectionResult {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select (or clear with null). Ends any active editing. */
  select(id: string | null): void;
  /** Select and start editing `id`. */
  startEdit(id: string): void;
  /** Stop editing; keep the note selected or clear the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Local, per-client selection and editing state. It is deliberately NOT stored
 * in the Y.Doc: which note I have selected or am typing in is my own view, not
 * shared board content (design: sticky.interaction).
 */
export function useSelection(): UseSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    setEditingId(null);
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
