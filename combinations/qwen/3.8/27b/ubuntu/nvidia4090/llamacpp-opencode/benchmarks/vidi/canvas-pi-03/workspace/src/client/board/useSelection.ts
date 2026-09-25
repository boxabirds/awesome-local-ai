import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface Selection {
  /** Id of the selected note, or null. Local to this client — never stored in the doc. */
  selectedId: string | null;
  /** Id of the note currently being edited, or null. */
  editingId: string | null;
  /** Selects a note (or clears the selection with null). Also clears editing. */
  select(id: string | null): void;
  /** Selects the note and starts editing it. */
  startEdit(id: string): void;
  /** Ends editing; the note stays selected or becomes unselected. */
  endEdit(next: EndEditNext): void;
}

/**
 * Local selection and editing state (story 2). Selection is a per-client
 * interaction concern and is never written to the Y.Doc (other users must not
 * see my selection as data; presence of selection is a later story).
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

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
