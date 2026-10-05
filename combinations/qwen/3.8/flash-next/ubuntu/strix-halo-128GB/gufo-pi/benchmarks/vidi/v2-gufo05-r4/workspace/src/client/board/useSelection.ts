/**
 * Which note is selected and which note is being typed into.
 *
 * This is *per-client* interaction state: two people on the same board (story 3)
 * each have their own selection, so it is never written to the shared document.
 */

import { useCallback, useMemo, useState } from 'react';

/** Where editing leaves the note. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionControls {
  /** The note with the blue outline and toolbar, if any. */
  selectedId: string | null;
  /** The note whose textarea is open, if any. */
  editingId: string | null;
  /** Select a note, or clear the selection with `null` (which also ends editing). */
  select(id: string | null): void;
  /** Open the note's textarea; the note is selected while editing. */
  startEdit(id: string): void;
  /** Close the textarea, keeping or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

export function useSelection(): SelectionControls {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // A selection change can never leave a textarea open on another note.
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

  return useMemo(
    () => ({ selectedId, editingId, select, startEdit, endEdit }),
    [selectedId, editingId, select, startEdit, endEdit]
  );
}
