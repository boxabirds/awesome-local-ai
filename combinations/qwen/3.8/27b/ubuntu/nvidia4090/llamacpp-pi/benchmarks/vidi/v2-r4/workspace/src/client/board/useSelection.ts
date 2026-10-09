/**
 * Local selection + editing state (story 2).
 *
 * Selection and editing are per-client interaction state: they are never
 * written to the Y.Doc, so two people on the same board (story 3) select and
 * edit independently.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import {
  deleteObject,
  type StickySnapshot,
} from "../../shared/board-model";

export interface SelectionApi {
  /** Currently selected note id, if any. */
  readonly selectedId: string | null;
  /** Note id currently in text editing mode, if any. */
  readonly editingId: string | null;
  /** Select a note; `null` clears the selection (and ends any editing). */
  select(id: string | null): void;
  /** Select the note and start editing it. */
  startEdit(id: string): void;
  /** Stop editing; `"selected"` keeps the selection, `"unselected"` clears it. */
  endEdit(next: "selected" | "unselected"): void;
}

export function useSelection(): SelectionApi {
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

  const endEdit = useCallback((next: "selected" | "unselected") => {
    setEditingId(null);
    if (next === "unselected") setSelectedId(null);
  }, []);

  return useMemo(
    () => ({ selectedId, editingId, select, startEdit, endEdit }),
    [selectedId, editingId, select, startEdit, endEdit],
  );
}

/**
 * Clear selection/editing that points at a note which has disappeared
 * (deleted mid-drag or mid-edit) so stale ids never linger.
 */
export function usePruneSelection(
  notes: readonly StickySnapshot[],
  sel: SelectionApi,
): void {
  const { selectedId, editingId, select, endEdit } = sel;
  useEffect(() => {
    if (selectedId === null) return;
    const exists = notes.some((n) => n.id === selectedId);
    if (!exists) {
      select(null);
      return;
    }
    if (editingId !== null && !notes.some((n) => n.id === editingId)) {
      endEdit("unselected");
    }
  }, [notes, selectedId, editingId, select, endEdit]);
}

/**
 * Window-level keyboard shortcuts for the selected note:
 *  - Enter on a selected, non-editing note starts editing (sticky.edit_start).
 *  - Delete / Backspace on a selected, non-editing note deletes it
 *    (sticky.delete). While editing, these keys edit text in the textarea
 *    and never remove the note.
 * Ignored entirely while focus is in a text field (inputs, textareas,
 * contenteditable) or a note is being edited.
 */
export function useStickyKeyboard(doc: Y.Doc, sel: SelectionApi): void {
  const { selectedId, editingId, select, startEdit } = sel;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable);
      if (inField || editingId !== null || selectedId === null) return;
      if (event.key === "Enter") {
        event.preventDefault();
        startEdit(selectedId);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc, selectedId, editingId, select, startEdit]);
}
