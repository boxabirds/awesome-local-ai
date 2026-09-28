import { useCallback, useState } from 'react';

export type EndNext = 'selected' | 'unselected';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndNext): void;
}

/**
 * Local (per-client) selection and editing state for board objects. Never stored
 * in the Y.Doc — other users must not see my selection as data (a later story
 * adds presence). `select` always drops any in-progress edit; `startEdit` selects
 * and edits; `endEdit` stops editing and, when next === 'unselected', also clears
 * the selection.
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

  const endEdit = useCallback((next: EndNext) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
