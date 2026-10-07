import { useCallback, useState } from "react";

/**
 * Board selection and edit mode (sticky.selection, sticky.edit_start).
 *
 * Both are local UI state: they live in App, not in the document, because
 * "which note I have selected" is not something two people share.
 */
export type EndEditNext = "selected" | "unselected";

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with `null` (which ends editing). */
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId((previous) => (previous === id ? previous : id));
    if (id === null) {
      setEditingId(null);
    } else {
      // Editing a different note ends, because focus has moved away from it.
      setEditingId((previous) => (previous !== null && previous !== id ? null : previous));
    }
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === "unselected") setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
