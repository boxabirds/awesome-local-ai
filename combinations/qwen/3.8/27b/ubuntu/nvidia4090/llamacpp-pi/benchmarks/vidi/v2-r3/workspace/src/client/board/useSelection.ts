import { useCallback, useEffect, useState } from 'react';
import type { StickySnapshot } from '../../shared/board-model';

/**
 * Local selection + editing state. Never written to the document: selections
 * stay personal (live.local_selection). When a note disappears (deleted by
 * someone else while selected or being edited) the stale ids are cleared so
 * editing/dragging simply ends with no error (live.delete_during_edit).
 */
export function useSelection(notes: readonly StickySnapshot[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const ids = new Set(notes.map((n) => n.id));
    setSelectedId((id) => (id !== null && !ids.has(id) ? null : id));
    setEditingId((id) => (id !== null && !ids.has(id) ? null : id));
  }, [notes]);

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
