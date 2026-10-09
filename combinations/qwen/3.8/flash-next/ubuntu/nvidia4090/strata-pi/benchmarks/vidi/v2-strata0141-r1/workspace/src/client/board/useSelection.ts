import { useCallback, useState } from 'react';

/**
 * Which note is selected and which one is being edited (anchor
 * `sticky.interaction`).
 *
 * This is per-client interaction state: it is deliberately *not* stored in the
 * Y.Doc, so selecting a note never syncs or persists anything.
 */
export interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
}

export interface Selection extends SelectionState {
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: 'selected' | 'unselected'): void;
}

const EMPTY: SelectionState = { selectedId: null, editingId: null };

export function useSelection(): Selection {
  const [state, setState] = useState<SelectionState>(EMPTY);

  const select = useCallback((id: string | null) => {
    setState((previous) => ({
      selectedId: id,
      // Selecting another note (or nothing) ends editing; keeping the same note
      // selected while it is being edited does not.
      editingId: previous.editingId === id ? previous.editingId : null,
    }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setState((previous) => {
      if (previous.editingId === null) {
        return previous; // already ended (e.g. a blur after clicking elsewhere)
      }
      const keepSelection =
        next === 'selected' || previous.selectedId !== previous.editingId;
      return {
        selectedId: keepSelection ? previous.selectedId : null,
        editingId: null,
      };
    });
  }, []);

  return { ...state, select, startEdit, endEdit };
}
