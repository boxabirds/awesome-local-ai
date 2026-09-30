import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(
  _doc: Y.Doc,
  notes: readonly StickySnapshot[],
): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
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

  // Clear selection/editing when a note is deleted remotely
  useEffect(() => {
    if (selectedId && !notes.find((n) => n.id === selectedId)) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [notes, selectedId]);

  return { selectedId, editingId, select, startEdit, endEdit };
}
