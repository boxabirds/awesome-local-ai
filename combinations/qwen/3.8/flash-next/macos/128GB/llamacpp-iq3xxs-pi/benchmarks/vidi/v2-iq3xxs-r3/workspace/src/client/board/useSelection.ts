import { useCallback, useState } from 'react';

/**
 * Which note is selected and which is being edited — per-client interaction
 * state, never written to the Y.Doc (another user's cursor must not change
 * what you have selected).
 */
export interface SelectionController {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select `id`, or clear the selection with `null` (also ends editing). */
  select(id: string | null): void;
  /** Start editing a note; implies it is selected. */
  startEdit(id: string): void;
  /** End editing; the note stays selected or is deselected. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): SelectionController {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Leaving for another note (or nowhere) ends any edit; re-selecting the
    // note being edited keeps the editor mounted.
    setEditingId((current) => (current !== null && current === id ? current : null));
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
