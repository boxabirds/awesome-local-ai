import { useCallback, useState } from 'react';

/** What selection to land on when text editing finishes. */
export type EndEditTarget = 'selected' | 'unselected';

export interface SelectionApi {
  /** Id of the note with the selection outline + toolbar, or null. */
  selectedId: string | null;
  /** Id of the note whose text is being edited, or null. */
  editingId: string | null;
  /** Select a note (or clear with null). Always drops any editing state. */
  select(id: string | null): void;
  /** Begin editing a note's text (implies it is selected). */
  startEdit(id: string): void;
  /** Finish editing, landing on the given selection. */
  endEdit(next: EndEditTarget): void;
}

/**
 * Per-client selection + editing state. This is deliberately *local* React state
 * that is never written to the shared Y.Doc — which note one user has selected
 * must not appear on anyone else's screen (see sticky.interaction contract).
 *
 * Editing implies selection: while a note is edited it is also selected, so
 * ending an edit back to "selected" simply clears the editing flag and leaves
 * `selectedId` untouched.
 */
export function useSelection(): SelectionApi {
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

  const endEdit = useCallback((next: EndEditTarget) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
