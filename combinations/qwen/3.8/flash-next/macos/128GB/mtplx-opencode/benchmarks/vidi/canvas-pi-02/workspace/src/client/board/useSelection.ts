import { useRef, useState } from 'react';

/**
 * What is selected and what is being edited, for this browser only.
 *
 * Selection is deliberately *not* stored in the Y.Doc (design "Key decisions":
 * my selection must not become board data, and it costs nothing to move).
 * It lives in React state so the outline, the toolbar and the keyboard
 * shortcuts re-render with it.
 */
export interface SelectionState {
  selectedId: string | null;
  editingId: string | null;
}

export interface SelectionApi {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select a note (null clears the selection) and leave any edit. */
  select(id: string | null): void;
  /** Select a note and put its text in edit mode. */
  startEdit(id: string): void;
  /**
   * Leave edit mode. `selected` keeps the note selected (Escape), `unselected`
   * drops it (a click on the empty board).
   */
  endEdit(next: 'selected' | 'unselected'): void;
  /** The same state, for listeners that are bound once and must not go stale. */
  current(): SelectionState;
}

const IDLE: SelectionState = { selectedId: null, editingId: null };

export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState>(IDLE);

  // Listeners bound once (the window keydown handler, the note's pointer
  // handlers) read the selection through this ref, so the returned object can
  // keep one identity for the whole session.
  const stateRef = useRef<SelectionState>(state);
  stateRef.current = state;

  const apiRef = useRef<SelectionApi | null>(null);
  if (apiRef.current === null) {
    const ref = stateRef;
    apiRef.current = {
      get selectedId() {
        return ref.current.selectedId;
      },
      get editingId() {
        return ref.current.editingId;
      },
      current() {
        return ref.current;
      },
      select(id) {
        setState({ selectedId: id, editingId: null });
      },
      startEdit(id) {
        setState({ selectedId: id, editingId: id });
      },
      endEdit(next) {
        setState((previous) =>
          next === 'selected'
            ? { selectedId: previous.editingId ?? previous.selectedId, editingId: null }
            : IDLE,
        );
      },
    };
  }

  return apiRef.current;
}
