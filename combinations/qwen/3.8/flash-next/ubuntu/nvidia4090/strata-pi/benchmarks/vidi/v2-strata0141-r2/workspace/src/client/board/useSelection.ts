import { useCallback, useState } from 'react';

/**
 * Which note this client has selected, and which one it is typing in.
 *
 * Both are strictly local: they are never written to the Y.Doc, so another
 * person's cursor in their note does not change what this page shows.
 */

/** What selection becomes when editing ends. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionController {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note, or clear the selection with `null` (which also ends editing). */
  select(id: string | null): void;
  /** Start typing in a note (implies selection). */
  startEdit(id: string): void;
  /** Stop typing; keep or drop the selection. */
  endEdit(next: EndEditNext): void;
}

export function useSelection(): SelectionController {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null): void => {
    setSelectedId(id);
    if (id === null) {
      setEditingId(null);
    }
  }, []);

  const startEdit = useCallback((id: string): void => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext): void => {
    setEditingId(null);
    if (next === 'unselected') {
      setSelectedId(null);
    }
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
