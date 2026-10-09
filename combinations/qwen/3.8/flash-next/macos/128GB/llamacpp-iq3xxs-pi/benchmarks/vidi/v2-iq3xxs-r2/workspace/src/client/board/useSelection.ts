import { useCallback, useState } from 'react';

/** What happens to a note's selection when editing ends. */
export type EndEditNext = 'selected' | 'unselected';

export interface Selection {
  /** The note with the blue outline and the floating toolbar, if any. */
  readonly selectedId: string | null;
  /** The note whose textarea is open, if any. */
  readonly editingId: string | null;
  select(id: string | null): void;
  startEdit(id: string): void;
  endEdit(next: EndEditNext): void;
}

interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
}

const NOTHING: SelectionState = { selectedId: null, editingId: null };

const same = (a: SelectionState, b: SelectionState): boolean =>
  a.selectedId === b.selectedId && a.editingId === b.editingId;

/**
 * Which note this client has selected and which one it is typing in.
 *
 * Both are strictly local: they are never written to the `Y.Doc`, so another person's
 * cursor and selection (story 3) cannot steal ours.
 */
export function useSelection(): Selection {
  const [state, setState] = useState<SelectionState>(NOTHING);

  /** Selecting another note (or nothing) closes the editor of the old one. */
  const select = useCallback((id: string | null): void => {
    setState((previous) => {
      const next = { selectedId: id, editingId: null };
      return same(previous, next) ? previous : next;
    });
  }, []);

  const startEdit = useCallback((id: string): void => {
    setState((previous) => {
      const next = { selectedId: id, editingId: id };
      return same(previous, next) ? previous : next;
    });
  }, []);

  const endEdit = useCallback((next: EndEditNext): void => {
    setState((previous) => {
      const done =
        next === 'selected'
          ? { selectedId: previous.selectedId, editingId: null }
          : NOTHING;
      return same(previous, done) ? previous : done;
    });
  }, []);

  return {
    selectedId: state.selectedId,
    editingId: state.editingId,
    select,
    startEdit,
    endEdit,
  };
}
