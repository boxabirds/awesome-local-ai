import { useState, useCallback } from 'react';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select: (id: string | null) => void;
  startEdit: (id: string) => void;
  endEdit: (next: 'selected' | 'unselected') => void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

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
