import { useEffect } from 'react';
import type * as Y from 'yjs';
import { deleteObject } from '../../shared/board-model';
import type { SelectionApi } from './useSelection';

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true;
}

// Window-level keyboard handling for the selected note: Enter starts editing,
// Delete/Backspace delete it. While editing, every key is left to the textarea.
export function useNoteKeys(doc: Y.Doc, selection: SelectionApi): void {
  const { selectedId, editingId, select, startEdit } = selection;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingId !== null) return;
      if (selectedId === null) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, select, startEdit]);
}
