// useSelection (story 2): local selection + editing state.
// Selection and editing are per-client UI state — never stored in the Y.Doc.

import { useCallback, useState } from 'react';

export interface Selection {
  /** The selected note id, if any. */
  readonly selectedId: string | null;
  /** The note id being edited, if any. */
  readonly editingId: string | null;
  /** The note id currently being dragged, if any (hides the note toolbar). */
  readonly draggingId: string | null;
  /** Select a note, or null to clear the selection. */
  select(id: string | null): void;
  /** Start editing a note (also selects it). */
  startEdit(id: string): void;
  /**
   * End editing. `'selected'` keeps the edited note selected (Escape),
   * `'unselected'` clears the selection (click outside).
   */
  endEdit(next: 'selected' | 'unselected'): void;
  /** Track the note being dragged (null when the drag ends). */
  setDragging(id: string | null): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting another note ends any edit (editing and selecting another
    // note are mutually exclusive states).
    if (id === null) setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  const setDragging = useCallback((id: string | null) => {
    setDraggingId(id);
  }, []);

  return { selectedId, editingId, draggingId, select, startEdit, endEdit, setDragging };
}
