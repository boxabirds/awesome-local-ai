import { useCallback, useEffect, useState } from 'react';
import type { StickySnapshot } from 'src/shared/board-model';

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
 *
 * Story 3: when a remote update deletes the note this client is selecting or
 * editing, the selection/editing is cleared (the editor unmounts and the drag
 * ends) with no error — live.delete_during_edit.
 */
export function useSelection(notes: readonly StickySnapshot[]): Selection {
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

  // The selected/edited note was deleted (locally or by someone else):
  // drop the selection and end editing. `select(null)` also clears editing.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [notes, selectedId]);

  return { selectedId, editingId, select, startEdit, endEdit };
}
