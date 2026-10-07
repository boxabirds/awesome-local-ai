import * as React from 'react';
import * as Y from 'yjs';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(doc?: Y.Doc): SelectionState {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Watch for remote deletions of the currently selected/editing note
  React.useEffect(() => {
    if (!doc) return;

    const objects = doc.getMap('objects');
    let currentSelected = selectedId;
    let currentEditing = editingId;

    const handler = () => {
      // Re-read state to check against latest
      currentSelected = selectedId;
      currentEditing = editingId;

      if (currentSelected !== null && !objects.has(currentSelected)) {
        setSelectedId(null);
        if (currentEditing === currentSelected) setEditingId(null);
      }
      if (currentEditing !== null && !objects.has(currentEditing)) {
        setEditingId(null);
      }
    };

    objects.observeDeep(handler);
    return () => {
      objects.unobserveDeep(handler);
    };
  }, [doc, selectedId, editingId]);

  const select = React.useCallback((id: string | null) => {
    setSelectedId(id);
    if (id === null) {
      setEditingId(null);
    }
  }, []);

  const startEdit = React.useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = React.useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') {
      setSelectedId(null);
    }
  }, []);

  return {
    selectedId,
    editingId,
    select,
    startEdit,
    endEdit,
  };
}
