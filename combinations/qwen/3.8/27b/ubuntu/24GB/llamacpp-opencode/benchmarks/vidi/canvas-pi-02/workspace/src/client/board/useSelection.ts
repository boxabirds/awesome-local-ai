import { useCallback, useMemo, useState } from 'react';

export interface Selection {
  /** Id of the selected note, or null. */
  selectedId: string | null;
  /** Id of the note being edited, or null. At most one at a time. */
  editingId: string | null;
  /** Select a note (and implicitly end any editing). `null` clears the selection. */
  select(id: string | null): void;
  /** Select the note and start editing it. */
  startEdit(id: string): void;
  /** Stop editing; keep the selection or clear it. */
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Local per-client selection and editing state. This is deliberately never
 * written to the Y.Doc: another user must not see my selection as data
 * (sharing selection presence is a later story).
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

  return useMemo(
    () => ({ selectedId, editingId, select, startEdit, endEdit }),
    [selectedId, editingId, select, startEdit, endEdit],
  );
}
