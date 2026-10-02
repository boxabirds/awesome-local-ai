import { useCallback, useMemo, useState } from 'react';

/** Where the note ends up when text editing finishes. */
export type EditEnd = 'selected' | 'unselected';

export interface Selection {
  /** The note with the blue outline, if any. */
  readonly selectedId: string | null;
  /** The note whose textarea is open, if any. */
  readonly editingId: string | null;
  /** Selects a note, or clears the selection with `null`. Ends any editing. */
  select(id: string | null): void;
  /** Opens the note for typing and selects it. */
  startEdit(id: string): void;
  /** Closes the editor, keeping the selection when asked to. */
  endEdit(next: EditEnd): void;
}

interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

const NOTHING: SelectionState = { selectedId: null, editingId: null };

/**
 * Which note is selected and which is being typed in.
 *
 * This is per-client interaction state and is deliberately *not* stored in the
 * `Y.Doc`: another person's selection must not change this screen (story 3).
 * One state object holds both ids so selecting can never leave a stale editor
 * open. `endEdit` ignores calls for an editor that has already closed, which is
 * what a stray blur after Escape looks like.
 */
export function useSelection(): Selection {
  const [state, setState] = useState<SelectionState>(NOTHING);

  const select = useCallback((id: string | null) => {
    setState({ selectedId: id, editingId: null });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: EditEnd) => {
    setState((current) => {
      if (current.editingId === null) return current; // already closed
      return next === 'selected'
        ? { selectedId: current.editingId, editingId: null }
        : NOTHING;
    });
  }, []);

  return useMemo(
    () => ({ ...state, select, startEdit, endEdit }),
    [state, select, startEdit, endEdit],
  );
}
