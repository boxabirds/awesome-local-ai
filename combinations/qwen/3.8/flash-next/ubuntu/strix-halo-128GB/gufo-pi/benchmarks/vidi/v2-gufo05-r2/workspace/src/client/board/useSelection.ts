import { useCallback, useEffect, useState } from 'react';

/**
 * Per-client selection and editing state. This is intentionally NOT stored in
 * the Y.Doc: which note *you* have selected or are typing in is local to your
 * page (other people select independently in story 3).
 */
export interface Selection {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with null. */
  select(id: string | null): void;
  /** Make a note selected and editing. */
  startEdit(id: string): void;
  /** Stop editing; keep the note selected, or drop the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
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

/**
 * Stop referring to a note that is gone. Somebody else on the board can delete
 * the note you have selected — while you are typing in it or dragging it — and
 * the instant it is off the board this page forgets it: the editor closes, the
 * drag goes with the note's element, and nothing keeps a handle on a note that
 * no longer exists.
 *
 * Selection and editing state stay strictly local (they are never written to the
 * document), so this is the only way a delete by someone else changes them.
 */
export function useForgetMissingNotes(
  selection: Selection,
  notes: readonly { readonly id: string }[],
): void {
  const { selectedId, editingId, select, endEdit } = selection;
  useEffect(() => {
    if (selectedId !== null && !notes.some((note) => note.id === selectedId)) {
      select(null); // drops the selection, and with it any editor on that note
    } else if (editingId !== null && !notes.some((note) => note.id === editingId)) {
      endEdit('selected');
    }
  }, [notes, selectedId, editingId, select, endEdit]);
}
