import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { deleteObject } from '../../shared/board-model';
import type { Selection } from './useSelection';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON' || target.isContentEditable;
}

/**
 * Window-level note keyboard rules (shared by App and the component-test
 * harness):
 *  - Enter on a selected, non-editing note starts editing (focus must not be
 *    in a field or on a button, so their native behaviour is untouched).
 *  - Delete/Backspace on a selected, non-editing note removes it; while
 *    editing text those keys edit the text instead and are ignored here.
 */
export function useBoardKeyboard(
  args: { doc: Y.Doc; selection: Selection; editable?: boolean },
): void {
  const { doc } = args;
  const selectionRef = useRef(args.selection);
  selectionRef.current = args.selection;
  const editableRef = useRef(args.editable ?? true);
  editableRef.current = args.editable ?? true;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const selection = selectionRef.current;
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Enter') {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          // persist.client_status: starting an edit is a no-op while locked.
          if (editableRef.current && selection.selectedId !== null && selection.editingId === null) {
            e.preventDefault();
            selection.startEdit(selection.selectedId);
          }
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // persist.client_status: delete is a no-op while locked.
        if (editableRef.current && selection.selectedId !== null && selection.editingId === null) {
          e.preventDefault();
          if (deleteObject(doc, selection.selectedId)) {
            selection.select(null);
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);
}
