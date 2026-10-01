import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface UseSelectionResult {
  /** Note with the blue outline and toolbar, or `null`. */
  selectedId: string | null;
  /** Note whose text is being edited, or `null`. Always a subset of `selectedId`. */
  editingId: string | null;
  /** Select a note, or clear the selection with `null`. Ends any edit. */
  select(id: string | null): void;
  /** Start editing a note (implies selecting it). */
  startEdit(id: string): void;
  /** Stop editing; keep the note selected or drop the selection, per `next`. */
  endEdit(next: EndEditNext): void;
}

/**
 * Per-client interaction state — which note is selected and which one is being edited.
 *
 * Selection is deliberately *not* stored in the Y.Doc: it is this user's pointer state, and
 * writing it to the shared document would fight with other users (story 3) and would leak
 * into persistence (story 4).
 */
export function useSelection(): UseSelectionResult {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setEditingId(null);
    setSelectedId(id);
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    setSelectedId((current) => (next === 'selected' ? current : null));
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
