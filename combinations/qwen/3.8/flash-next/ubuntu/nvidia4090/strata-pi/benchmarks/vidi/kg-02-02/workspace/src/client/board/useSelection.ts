import { useCallback, useState } from "react";

/** What selection becomes when text editing stops. */
export type EndEditNext = "selected" | "unselected";

export interface SelectionApi {
  /** Note the local user has selected, or null. */
  readonly selectedId: string | null;
  /** Note the local user is typing into, or null. */
  readonly editingId: string | null;
  /** Select a note, or clear the selection with `null`. Clears editing. */
  select(id: string | null): void;
  /** Start text editing on a note. */
  startEdit(id: string): void;
  /** Stop text editing, keeping or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

interface SelectionState {
  readonly selectedId: string | null;
  readonly editingId: string | null;
}

const EMPTY: SelectionState = { selectedId: null, editingId: null };

/**
 * Which note *this client* has selected and is editing.
 *
 * Deliberately local React state, never written to the Y.Doc: selection and
 * caret position are per-person, and putting them in the shared document would
 * make people fight over one another's notes (story 6 shows presence instead).
 */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState>(EMPTY);

  const select = useCallback((id: string | null) => {
    setState((prev) => (prev.selectedId === id && prev.editingId === null ? prev : { selectedId: id, editingId: null }));
  }, []);

  const startEdit = useCallback((id: string) => {
    setState((prev) => (prev.editingId === id && prev.selectedId === id ? prev : { selectedId: id, editingId: id }));
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setState((prev) => {
      if (prev.editingId === null) return prev;
      return { selectedId: next === "selected" ? prev.selectedId : null, editingId: null };
    });
  }, []);

  return { selectedId: state.selectedId, editingId: state.editingId, select, startEdit, endEdit };
}
