import { useCallback, useMemo, useState } from "react";

/** What the note toolbar and the keyboard rules need from selection state. */
export type EditEnd = "selected" | "unselected";

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Selects a note, or clears the selection (and with it, editing). */
  select(id: string | null): void;
  /** Starts text editing; the note is selected too. */
  startEdit(id: string): void;
  /** Stops editing, keeping or clearing the selection. */
  endEdit(next: EditEnd): void;
}

/**
 * Which note is selected and which one is being edited.
 *
 * Both are strictly per-client view state: they are never written to the Y.Doc,
 * so another person's cursor or editor can never change what this page shows.
 */
export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId((prev) => (prev === id ? prev : id));
    if (id === null) setEditingId((prev) => (prev === null ? prev : null));
  }, []);

  const startEdit = useCallback((id: string) => {
    setEditingId((prev) => (prev === id ? prev : id));
    setSelectedId((prev) => (prev === id ? prev : id));
  }, []);

  const endEdit = useCallback((next: EditEnd) => {
    setEditingId((prev) => (prev === null ? prev : null));
    if (next === "unselected") setSelectedId((prev) => (prev === null ? prev : null));
  }, []);

  return useMemo(
    () => ({ selectedId, editingId, select, startEdit, endEdit }),
    [selectedId, editingId, select, startEdit, endEdit],
  );
}
