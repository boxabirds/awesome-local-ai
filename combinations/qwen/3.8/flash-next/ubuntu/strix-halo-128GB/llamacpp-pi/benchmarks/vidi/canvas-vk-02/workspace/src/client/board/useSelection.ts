import { useCallback, useState } from 'react';

export interface Selection {
  /** The note that is outlined and shows its toolbar, or `null`. */
  selectedId: string | null;
  /** The note whose text is being edited, or `null`. */
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Selection and editing state for the board. This is deliberately *local*: the
 * Y.Doc never stores which note a particular user has selected or is editing
 * (that would leak my cursor into other people's boards; shared selection is a
 * later story). Only one note is ever selected or edited.
 */
export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setEditingId(null);
    setSelectedId(id);
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
