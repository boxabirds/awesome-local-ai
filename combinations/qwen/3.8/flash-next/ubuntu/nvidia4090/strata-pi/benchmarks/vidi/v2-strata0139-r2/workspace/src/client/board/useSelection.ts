import { useCallback, useState } from "react";

/**
 * Local selection and editing state.
 *
 * Which note *this* client has selected, and which one it is typing in. This
 * is per-client view state and is deliberately never written to the Y.Doc: two
 * people on the same board (story 3) select different notes.
 */
export type EndEditNext = "selected" | "unselected";

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Selects a note, or clears the selection when called with null. */
  select(id: string | null): void;
  /** Selects a note and starts editing it. */
  startEdit(id: string): void;
  /** Stops editing; the note stays selected or becomes unselected. */
  endEdit(next: EndEditNext): void;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId((previous) => (previous === id ? previous : id));
    // Selecting somewhere else (including empty board space) ends editing.
    setEditingId((previous) => (previous === null || previous === id ? previous : null));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId((previous) => (previous === id ? previous : id));
    setEditingId((previous) => (previous === id ? previous : id));
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === "unselected") setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
