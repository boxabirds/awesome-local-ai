import { useCallback, useState } from 'react';

/** What to select when text editing ends. */
export type EndEditNext = 'selected' | 'unselected';

/** Local (never synced) selection and editing state for the whole board. */
export interface Selection {
  /** The note with the blue outline and the note toolbar, if any. */
  selectedId: string | null;
  /** The note whose text is being edited, if any. */
  editingId: string | null;
  /** Selects a note; `null` clears the selection (and with it, editing). */
  select(id: string | null): void;
  /** Starts text editing on a note (which is then also selected). */
  startEdit(id: string): void;
  /** Ends text editing, keeping or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

/**
 * Selection and editing state.
 *
 * This is per-client UI state: it is deliberately never written to the `Y.Doc`,
 * so my cursor is never somebody else's cursor (story 3). Only one note can be
 * selected and one note can be edited at a time.
 */
export function useSelection(): Selection {
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

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
