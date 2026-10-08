import { useEffect } from 'react';
import type * as Y from 'yjs';
import { deleteObject } from '../../shared/board-model';

/**
 * Window-level keyboard handling for sticky notes (story 2):
 *
 * - Enter on a selected, not-editing note starts editing (sticky.edit_start).
 * - Delete/Backspace on a selected, not-editing note deletes it
 *   (sticky.delete). While a note is being edited, or focus is in any input,
 *   these keys never touch the board model — they edit text instead.
 */
export function useStickyKeyboard(options: {
  doc: Y.Doc;
  selectedId: string | null;
  editingId: string | null;
  select: (id: string | null) => void;
  startEdit: (id: string) => void;
  /**
   * Whether the board is editable (persist.client_status). When false (the
   * board failed to load) Enter-to-edit and Delete-to-delete are no-ops so a
   * load-failed board can never be mutated.
   */
  editable?: boolean;
}): void {
  const { doc, selectedId, editingId, select, startEdit, editable = true } = options;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (editingId !== null) {
        return; // keys go to the textarea: they edit characters, not notes
      }
      if (selectedId === null) {
        return;
      }
      if (!editable) {
        return; // load_failed: editing is locked out
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        return; // focus is in a text input
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (deleteObject(doc, selectedId)) {
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [doc, selectedId, editingId, select, startEdit, editable]);
}
