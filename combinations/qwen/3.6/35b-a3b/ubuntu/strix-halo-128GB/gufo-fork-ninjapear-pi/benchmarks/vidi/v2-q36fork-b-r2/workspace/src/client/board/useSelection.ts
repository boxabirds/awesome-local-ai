import * as React from 'react';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(): SelectionState {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

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
