// Local per-client selection + editing state (story 2). Never written to the
// Y.Doc: other users must not see my selection as data (presence is story 6).

import { useCallback, useState } from 'react';

export type EditEnd = 'selected' | 'unselected';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note, or pass null to clear the selection (and editing). */
  select(id: string | null): void;
  /** Select the note and start editing it (cursor at the end of the text). */
  startEdit(id: string): void;
  /**
   * Stop editing. 'selected' keeps the note selected (Escape); 'unselected'
   * also clears the selection (click outside / blur).
   */
  endEdit(next: EditEnd): void;
}

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

  const endEdit = useCallback((next: EditEnd) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
