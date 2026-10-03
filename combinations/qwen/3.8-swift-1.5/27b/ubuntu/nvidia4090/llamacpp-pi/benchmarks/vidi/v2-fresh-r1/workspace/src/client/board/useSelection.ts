// Local selection + editing state (never stored in the Y.Doc).

import { useCallback, useEffect, useState } from 'react';
import type { StickySnapshot } from '../../shared/board-model';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Local selection. When `objects` is provided, selection/editing state is
 * cleared automatically if the selected note disappears (e.g. deleted by
 * someone else over sync).
 */
export function useSelection(objects?: readonly StickySnapshot[]): SelectionApi {
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

  // Drop selection/edit state for notes that no longer exist.
  useEffect(() => {
    if (!objects) return;
    const ids = new Set(objects.map((o) => o.id));
    if (selectedId !== null && !ids.has(selectedId)) setSelectedId(null);
    if (editingId !== null && !ids.has(editingId)) setEditingId(null);
  }, [objects, selectedId, editingId]);

  return { selectedId, editingId, select, startEdit, endEdit };
}
