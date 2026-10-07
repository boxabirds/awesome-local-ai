import { useCallback, useMemo, useState } from 'react';

/** What this client has selected / is typing. Never stored in the Y.Doc. */
export interface Selection {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select an id, or pass null to clear the selection (and any edit). */
  select(id: string | null): void;
  /** Select the note and start text editing on it. */
  startEdit(id: string): void;
  /** Stop editing; keep or drop the selection. */
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Local-only selection and editing state for the board (per client). It is
 * deliberately not part of the document: another user's cursor must never end
 * my text editing, and stories 3-4 must not sync it.
 */
export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId((prev) => (prev === id ? prev : id));
    setEditingId((prev) => (prev === null ? prev : null));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? prev : id));
    setEditingId((prev) => (prev === id ? prev : id));
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return useMemo(
    () => ({ selectedId, editingId, select, startEdit, endEdit }),
    [selectedId, editingId, select, startEdit, endEdit],
  );
}
