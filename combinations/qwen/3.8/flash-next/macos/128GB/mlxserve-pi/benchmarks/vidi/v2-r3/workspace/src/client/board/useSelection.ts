import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionApi {
  /** Id of the note with the blue outline, or null. */
  selectedId: string | null;
  /** Id of the note whose textarea is open, or null. */
  editingId: string | null;
  /** Select a note (null = empty board space was clicked); ends any editing. */
  select(id: string | null): void;
  /** Open the text editor of a note with the caret at the end of its text. */
  startEdit(id: string): void;
  /** Close the editor, keeping the note selected or deselecting it. */
  endEdit(next: EndEditNext): void;
}

/**
 * Which note is selected and which is being edited. This is *per-client
 * interaction state*: two people looking at the same board select different
 * notes, so it is deliberately never written to the shared Y.Doc.
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

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
