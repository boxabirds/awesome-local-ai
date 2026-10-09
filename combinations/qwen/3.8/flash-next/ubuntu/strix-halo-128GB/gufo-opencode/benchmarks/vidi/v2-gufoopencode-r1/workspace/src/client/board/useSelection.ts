import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

// Selection and editing are per-client UI state and are never written to the
// Y.Doc. When a doc is given (story 3), an edit by anyone — including a remote
// delete of the note being selected, edited or dragged — clears the stale ids
// here; drags end on their own because moveObject stops succeeding.
export function useSelection(doc?: Y.Doc): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (doc === undefined) return;
    const objects = doc.getMap('objects');
    const observer = (): void => {
      setSelectedId((id) => (id !== null && !objects.has(id) ? null : id));
      setEditingId((id) => (id !== null && !objects.has(id) ? null : id));
    };
    objects.observe(observer);
    return () => objects.unobserve(observer);
  }, [doc]);

  const select = useCallback((id: string | null) => {
    setEditingId(null);
    setSelectedId(id);
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
