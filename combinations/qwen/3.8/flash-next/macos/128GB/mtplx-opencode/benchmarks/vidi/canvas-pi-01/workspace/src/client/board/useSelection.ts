/**
 * Story 2 · the `useSelection` hook (design "Sticky note interaction").
 *
 * Selection and editing are **local, per-client state** and are never written
 * to the Y.Doc: another person must not see my selection as board data (that
 * is a presence feature in a later story). This hook owns just two ids and the
 * transitions between Unselected / Selected / Editing.
 */
import { useCallback, useState } from 'react';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note (or null to clear). Clears any active editing. */
  select(id: string | null): void;
  /** Begin editing a note (implies it is selected). */
  startEdit(id: string): void;
  /** Finish editing, keeping the selection or dropping it. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}