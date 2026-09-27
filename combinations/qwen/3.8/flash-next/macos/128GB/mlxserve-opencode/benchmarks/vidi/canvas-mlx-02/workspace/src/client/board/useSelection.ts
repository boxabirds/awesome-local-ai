// Local per-client selection + editing state (story 2). NEVER stored in the
// Y.Doc — other users must not see my selection as data (presence is a later
// story).
import { useCallback, useState } from 'react';

export type EndMode = 'selected' | 'unselected';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndMode): void;
  // Clear selection / editing when a selected/edited id leaves the document
  // (a remote delete). Selection is a purely local, transient fact, so dropping a
  // vanished id has no server cost and cannot race a CRDT merge.
  pruneTo(liveIds: ReadonlySet<string>): void;
}

export function useSelection(): SelectionApi {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Selecting another note (or clearing) ends any edit.
    setEditingId((prev) => (prev !== null && prev !== id ? null : prev));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndMode) => {
    setEditingId((cur) => {
      if (next === 'unselected') {
        // Clicking away drops the selection too.
        setSelectedId(null);
      }
      void cur;
      return null;
    });
  }, []);

  const pruneTo = useCallback((liveIds: ReadonlySet<string>) => {
    setSelectedId((id) => (id !== null && !liveIds.has(id) ? null : id));
    setEditingId((id) => (id !== null && !liveIds.has(id) ? null : id));
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit, pruneTo };
}
