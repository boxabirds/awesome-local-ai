import { useCallback, useState } from 'react';

/**
 * Local, per-client selection + editing state for the board. This is NEVER
 * written to the Y.Doc: a user's selection is not board data (shared selection
 * presence is a later story). Only one note can be selected and at most one can
 * be edited at a time.
 */
export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  /** Make `id` the selected note and leave edit mode (null clears selection). */
  select(id: string | null): void;
  /** Select and begin text-editing `id`. */
  startEdit(id: string): void;
  /** Stop editing; 'selected' keeps the note selected, 'unselected' clears it. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditingId(null);
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