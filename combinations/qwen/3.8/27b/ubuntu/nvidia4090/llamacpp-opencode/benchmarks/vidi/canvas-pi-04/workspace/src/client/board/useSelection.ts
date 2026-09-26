// Story 2: per-client selection and editing state (anchor: sticky.interaction).
//
// Deliberately local React state, never written to the Y.Doc: other people's
// screens must not show my selection or editing state (PRD live.local_selection).

import { useCallback, useState } from 'react';

export interface Selection {
  /** The selected note, if any. */
  selectedId: string | null;
  /** The note being edited, if any (implies it is also selected). */
  editingId: string | null;
  /** Select a note, or pass null to clear the selection (and end editing). */
  select: (id: string | null) => void;
  /** Select the note and start editing it. */
  startEdit: (id: string) => void;
  /** End editing; keep the selection when `next` is 'selected'. */
  endEdit: (next: 'selected' | 'unselected') => void;
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

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
