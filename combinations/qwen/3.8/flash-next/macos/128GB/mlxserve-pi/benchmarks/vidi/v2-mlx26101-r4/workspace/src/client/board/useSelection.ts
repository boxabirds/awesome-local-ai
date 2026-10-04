/**
 * Which note is selected and which one is being typed in.
 *
 * This is *local* state, deliberately never written to the `Y.Doc`: my cursor in
 * someone else's note is not something they should see, and once story 3 shares
 * the document it must not be synced by accident.
 *
 * At most one note is selected and at most one is edited at a time, which is why
 * `endEdit` does not need to be told which note it is finishing.
 */
import { useCallback, useRef, useState } from 'react';

/** Where a note goes when editing stops: stay selected, or let go entirely. */
export type EndEditTarget = 'selected' | 'unselected';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note, or pass null for the empty board space that deselects. */
  select(id: string | null): void;
  /** Start typing in a note (which also selects it). */
  startEdit(id: string): void;
  /** Stop typing; the note stays selected or is dropped, per `next`. */
  endEdit(next: EndEditTarget): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The id being edited, kept in a ref so `endEdit` can decide whether to keep
  // it selected without reading state that may not have committed yet.
  const editingRef = useRef<string | null>(null);

  const select = useCallback((id: string | null): void => {
    editingRef.current = null;
    setEditingId(null);
    setSelectedId(id);
  }, []);

  const startEdit = useCallback((id: string): void => {
    editingRef.current = id;
    setEditingId(id);
    setSelectedId(id);
  }, []);

  const endEdit = useCallback((next: EndEditTarget): void => {
    const id = editingRef.current;
    editingRef.current = null;
    setEditingId(null);
    setSelectedId(next === 'selected' ? id : null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
