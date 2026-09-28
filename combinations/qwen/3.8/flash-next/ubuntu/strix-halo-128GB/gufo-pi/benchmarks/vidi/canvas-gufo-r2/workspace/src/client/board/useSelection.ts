/**
 * Local selection and editing state.
 * Never stored in the Y.Doc: other users must not see my selection as data
 * (presence of selection is a later story).
 */
import { useCallback, useRef, useState } from 'react';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);

  const select = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    if (id === null) setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string) => {
    selectedIdRef.current = id;
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') {
      selectedIdRef.current = null;
      setSelectedId(null);
    }
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
