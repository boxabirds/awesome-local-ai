import { useCallback, useState } from 'react';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  select: (id: string | null) => void;
  startEdit: (id: string) => void;
  endEdit: (next: 'selected' | 'unselected') => void;
}

/**
 * Local selection and editing state for this client.
 *
 * Deliberately never written to the Y.Doc: other users must not see my
 * selection as data (presence of selection is a later story).
 */
export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) setEditingId(null);
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
