import { useCallback, useState } from 'react';

/**
 * Local selection and editing state. Never stored in the Y.Doc — selections
 * and editing state are personal (live.local_selection).
 */
export function useSelection() {
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
    if (next === 'unselected') {
      setSelectedId(null);
    }
  }, []);

  /**
   * Clear selection/editing that refers to notes no longer on the board
   * (e.g. a remote deletion while this screen was typing in or dragging the
   * note — live.delete_during_edit). The editor unmounts with the note and
   * the drag simply ends; no error is shown.
   */
  const prune = useCallback((existingIds: ReadonlySet<string>) => {
    setSelectedId((id) => (id !== null && !existingIds.has(id) ? null : id));
    setEditingId((id) => (id !== null && !existingIds.has(id) ? null : id));
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit, prune };
}
