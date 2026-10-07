import { useCallback, useState } from "react";

/**
 * Which note this client has selected and which one it is typing in.
 *
 * Selection and editing are **per client and never written to the Y.Doc**: two
 * people can select different notes on the same board, and story 6 adds remote
 * presence separately.
 */
export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: "selected" | "unselected"): void;
  /** True when this client is typing in `id`. */
  isEditing(id: string): boolean;
  isSelected(id: string): boolean;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting anywhere else (including empty board space) ends editing.
    setEditingId((previous) => (previous && previous !== id ? null : previous));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: "selected" | "unselected") => {
    setEditingId(null);
    if (next === "unselected") setSelectedId(null);
  }, []);

  const isSelected = useCallback((id: string) => selectedId === id, [selectedId]);
  const isEditing = useCallback((id: string) => editingId === id, [editingId]);

  return { selectedId, editingId, select, startEdit, endEdit, isEditing, isSelected };
}
