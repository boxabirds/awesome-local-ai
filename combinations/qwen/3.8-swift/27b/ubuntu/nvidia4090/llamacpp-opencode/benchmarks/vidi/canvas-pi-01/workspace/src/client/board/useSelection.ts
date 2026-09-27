// Local selection + editing state (see spec: sticky.interaction).
//
// Never written to the Y.Doc: other users must not see my selection as data
// (presence of selection is a later story).

import { useCallback, useEffect, useState } from 'react';
import type { StickySnapshot } from '../../shared/board-model';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note, or clear the selection (and editing) with null. */
  select(id: string | null): void;
  /** Select the note and start editing it. */
  startEdit(id: string): void;
  /** Escape → 'selected'; click outside → 'unselected'. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(notes: readonly StickySnapshot[]): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Someone else deleted the selected/edited note: clear the local state
  // silently so editing simply ends (live.delete_during_edit). A note being
  // dragged unmounts with the doc entry, ending its drag.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
    }
    if (editingId !== null && !notes.some((n) => n.id === editingId)) {
      setEditingId(null);
    }
  }, [notes, selectedId, editingId]);

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
