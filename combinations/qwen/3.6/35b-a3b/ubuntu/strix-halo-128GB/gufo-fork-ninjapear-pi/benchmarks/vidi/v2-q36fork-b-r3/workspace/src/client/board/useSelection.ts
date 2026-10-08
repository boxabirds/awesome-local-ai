import { useState, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { getDocObjects } from '@shared/board-model';

export function useSelection(doc: Y.Doc) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Clear selection/editing when the note is deleted
  useEffect(() => {
    const objects = getDocObjects(doc);
    const handler = () => {
      if (selectedId !== null && !objects.has(selectedId)) {
        setSelectedId(null);
        setEditingId(null);
      }
      if (editingId !== null && !objects.has(editingId)) {
        setEditingId(null);
      }
    };
    objects.observeDeep(handler);
    return () => objects.unobserveDeep(handler);
  }, [doc, selectedId, editingId]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id !== null) {
      setEditingId(null);
    }
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      setEditingId(null);
      if (next === 'unselected') {
        setSelectedId(null);
      }
    },
    [],
  );

  return { selectedId, editingId, select, startEdit, endEdit };
}
