import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface SelectionApi {
  selectedId: string | null;
  editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
  /**
   * Drop selection / editing if the referenced note no longer exists (e.g. another
   * client deleted it mid-edit). Keeps the interaction ending silently with no error
   * (live.delete_during_edit). `exists` is called with the id to test.
   */
  prune(exists: (id: string) => boolean): void;
}

/**
 * Local, per-client selection and editing state.
 * Never written to the Y.Doc: other users must not see my selection as data
 * (selection presence is a later story).
 */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<{ selectedId: string | null; editingId: string | null }>({
    selectedId: null,
    editingId: null,
  });

  const select = useCallback((id: string | null) => {
    setState({ selectedId: id, editingId: null });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setState((s) => {
      if (s.editingId === null) return s;
      if (next === 'selected') return { selectedId: s.editingId, editingId: null };
      // Unselected: only drop the selection when it still points at the note we edited.
      // Clicking another note selects it first; that selection must survive.
      return { selectedId: s.selectedId === s.editingId ? null : s.selectedId, editingId: null };
    });
  }, []);

  const prune = useCallback((exists: (id: string) => boolean) => {
    setState((s) => {
      const selectedOk = s.selectedId === null || exists(s.selectedId);
      const editingOk = s.editingId === null || exists(s.editingId);
      if (selectedOk && editingOk) return s;
      if (!editingOk) {
        // The edited note vanished: drop editing, and drop the selection too if it
        // still pointed at that same note.
        return { selectedId: selectedOk ? s.selectedId : null, editingId: null };
      }
      return { selectedId: null, editingId: s.editingId };
    });
  }, []);

  return {
    selectedId: state.selectedId,
    editingId: state.editingId,
    select,
    startEdit,
    endEdit,
    prune,
  };
}
