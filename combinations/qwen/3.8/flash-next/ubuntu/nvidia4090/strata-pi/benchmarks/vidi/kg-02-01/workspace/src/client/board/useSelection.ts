import { useCallback, useState } from "react";

/**
 * Local per-client interaction state: which note is selected, which note is
 * being edited, and which note is being dragged.
 *
 * This is deliberately *not* stored in the Y.Doc: another person's selection
 * is not part of the board. Story 6 shows other people's cursors through a
 * separate presence channel for the same reason.
 */
export type EndEditNext = "selected" | "unselected";

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Note currently under a drag (its toolbar is hidden while dragging). */
  readonly draggingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
  setDragging(id: string | null): void;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selection and editing never disagree: selecting another note (or none)
    // ends any edit that was running.
    setEditingId((current) => (current !== null && current !== id ? null : current));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === "unselected") setSelectedId(null);
  }, []);

  const setDragging = useCallback((id: string | null) => {
    setDraggingId(id);
  }, []);

  return { selectedId, editingId, draggingId, select, startEdit, endEdit, setDragging };
}
