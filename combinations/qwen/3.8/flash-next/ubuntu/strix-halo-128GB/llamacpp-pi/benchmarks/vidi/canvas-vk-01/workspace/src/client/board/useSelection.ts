import { useCallback, useState } from 'react';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
  /**
   * Forget `selectedId` / `editingId` when the object is gone (someone else
   * deleted it). An in-flight drag ends with the component, which unmounts.
   */
  pruneTo(visibleIds: Iterable<string>): void;
}

/**
 * Local selection + editing state for board objects.
 * Never stored in the Y.Doc (other users must not see my selection as data).
 */
export function useSelection(): SelectionState {
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

  const pruneTo = useCallback((visibleIds: Iterable<string>) => {
    const visible = new Set(visibleIds);
    setEditingId((editing) => (editing !== null && !visible.has(editing) ? null : editing));
    setSelectedId((selected) => (selected !== null && !visible.has(selected) ? null : selected));
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit, pruneTo };
}
