/**
 * Local selection and editing state for the board.
 *
 * Selection is per-client interaction state and is deliberately *never* written
 * to the Y.Doc: other users must not see my selection as board data (shared
 * cursors/presence are a later story).
 */
import { useCallback, useState } from 'react';

export interface Selection {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    if (id === null) setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string): void => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected'): void => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
