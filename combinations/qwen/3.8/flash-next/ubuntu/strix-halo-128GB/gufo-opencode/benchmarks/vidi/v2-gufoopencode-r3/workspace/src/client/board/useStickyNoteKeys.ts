import { useEffect } from 'react';
import type * as Y from 'yjs';
import { deleteObject } from '../../shared/board-model';
import type { SelectionState } from './useSelection';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

// Window-level keys: Enter edits the selected note; Delete/Backspace delete
// it — both ignored while editing text or when focus is in a text field.
// When `enabled` is false (load_failed board) the keys are inert (TC-23).
export function useStickyNoteKeys(
  doc: Y.Doc,
  selection: SelectionState,
  enabled = true
): void {
  const { selectedId, editingId, select, startEdit } = selection;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabled) return;
      if (isTextEntry(e.target)) return;
      if (editingId !== null) return;
      if (selectedId === null) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, select, startEdit, enabled]);
}
