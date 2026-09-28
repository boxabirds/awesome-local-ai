import { useCallback, useState } from 'react';

/**
 * Per-client selection and text-editing state.
 *
 * This is deliberately *not* stored in the Y.Doc: another person's cursor must
 * never appear as board data. Story 13+ shares selection as ephemeral presence,
 * not as document content.
 */
export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note, or clear everything with `null`. Editing follows along. */
  select(id: string | null): void;
  /** Select `id` and start editing its text. */
  startEdit(id: string): void;
  /** Stop editing; keep or drop the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Focusing another note ends the edit of the one being edited.
    if (id === null) setEditingId(null);
    else setEditingId((current) => (current === id ? current : null));
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
