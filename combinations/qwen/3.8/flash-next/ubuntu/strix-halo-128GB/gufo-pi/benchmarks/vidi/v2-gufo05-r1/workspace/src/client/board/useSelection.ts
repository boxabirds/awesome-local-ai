/**
 * Local interaction state for the board: which note is selected and which is
 * being edited.
 *
 * This is deliberately **not** part of the Y.Doc. Selection and the editing
 * caret belong to one person at the keyboard; putting them in the shared
 * document would fight the other people using the board (story 3) and would be
 * persisted for no reason (story 4).
 */
import { useCallback, useState } from 'react';

/** What selects a note after text editing ends. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with `null`. Ends any editing. */
  select(id: string | null): void;
  /** Select a note and put it into text editing. */
  startEdit(id: string): void;
  /** Leave text editing, keeping or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Editing follows the selection: picking another note (or nothing) leaves
    // the text editor behind.
    setEditingId((current) => (current !== null && current !== id ? null : current));
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
