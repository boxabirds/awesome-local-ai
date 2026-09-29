import { useCallback, useMemo, useState } from 'react';

/** What the selection becomes when text editing ends. */
export type EndEditNext = 'selected' | 'unselected';

export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

export interface SelectionApi extends SelectionState {
  /** Select one note, or clear the selection with `null`. Ends editing. */
  select(id: string | null): void;
  /** Select a note and start editing its text. */
  startEdit(id: string): void;
  /** Stop editing, keeping the note selected or dropping the selection. */
  endEdit(next: EndEditNext): void;
}

/**
 * Which note is selected and which one is being typed into.
 *
 * Both are local to this client and are deliberately *never* written to the
 * shared document: whose cursor is where is not part of the board's content
 * (story 3 shows other people's presence somewhere else entirely).
 */
export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState>({ selectedId: null, editingId: null });

  const select = useCallback((id: string | null) => {
    setState({ selectedId: id, editingId: null });
  }, []);

  const startEdit = useCallback((id: string) => {
    setState({ selectedId: id, editingId: id });
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setState((previous) => ({
      selectedId: next === 'selected' ? previous.editingId : null,
      editingId: null,
    }));
  }, []);

  return useMemo(() => ({ ...state, select, startEdit, endEdit }), [state, select, startEdit, endEdit]);
}

/** True when keyboard focus is on something that takes text. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT';
}
