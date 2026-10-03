import { useCallback, useState } from 'react';

/** Where a note ends up when text editing stops. */
export type EditEnd = 'selected' | 'unselected';

/**
 * Which note the local user has selected, and which one they are typing in.
 *
 * This is deliberately *not* stored in the Y.Doc: whose cursor is where belongs to this
 * browser only, and writing it to the shared document would make every click of every
 * participant move somebody else's selection.
 */
export interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with `null`. */
  select(id: string | null): void;
  /** Start typing in a note (which also selects it). */
  startEdit(id: string): void;
  /** Stop typing; Escape keeps the note selected, a click outside does not. */
  endEdit(next: EditEnd): void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    // Touching another note (or the board) ends any editing that was in progress.
    setEditingId((current) => (current !== null && current !== id ? null : current));
  }, []);

  const startEdit = useCallback((id: string): void => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EditEnd): void => {
    setEditingId(null);
    if (next === 'unselected') {
      setSelectedId(null);
    }
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
