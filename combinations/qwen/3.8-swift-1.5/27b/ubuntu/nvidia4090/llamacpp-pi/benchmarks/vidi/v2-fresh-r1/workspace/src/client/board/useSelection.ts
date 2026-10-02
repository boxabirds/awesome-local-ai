// Local selection + editing state (never stored in the Y.Doc).

import { useCallback, useState } from 'react';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting a different note ends editing on the current one
    if (id !== editingId) setEditingId(null);
  }, [editingId]);

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
