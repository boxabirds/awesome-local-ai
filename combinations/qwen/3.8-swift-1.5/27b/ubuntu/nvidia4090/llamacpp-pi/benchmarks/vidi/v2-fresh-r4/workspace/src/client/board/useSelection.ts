import { useCallback, useEffect, useState } from 'react';
import type { StickySnapshot } from '../../shared/board-model';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Local selection and editing state. Never written to the Y.Doc.
 * When a note is deleted remotely, selection/editing is cleared automatically.
 */
export function useSelection(notes?: readonly StickySnapshot[]): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Clear selection/editing when the referenced note is deleted
  useEffect(() => {
    if (!notes) return;
    const noteIds = new Set(notes.map((n) => n.id));
    if (selectedId && !noteIds.has(selectedId)) {
      setSelectedId(null);
      setEditingId(null);
    } else if (editingId && !noteIds.has(editingId)) {
      setEditingId(null);
    }
  }, [notes, selectedId, editingId]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) {
      setEditingId(null);
    }
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') {
      setSelectedId(null);
    }
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
