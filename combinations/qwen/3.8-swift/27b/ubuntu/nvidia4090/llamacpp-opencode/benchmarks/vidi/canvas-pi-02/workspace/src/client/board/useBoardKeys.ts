// Board keyboard shortcuts (story 7, sel.keyboard): Ctrl/Cmd+A, Escape,
// arrow nudge, Shift+arrow nudge, Delete/Backspace, Enter.
//
// While editing a note the editor owns the keyboard: every shortcut is
// inactive (the text input must keep its own Escape, arrows and Backspace).
// Nudging and deleting need an editable board (story 4 lock).

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit } = ref.current;

      if (selection.editingId !== null) return; // the editor owns the keyboard
      if (isTypingTarget(e.target)) return;

      // Select all (Ctrl/Cmd+A) — never while typing in a note.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Clear selection (also ends editing, which is already null here).
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow nudge (Shift = large step).
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      if (dx !== 0 || dy !== 0) {
        if (selection.ids.size === 0 || !canEdit) return;
        e.preventDefault();
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete / Backspace.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0 || !canEdit) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      // Enter: edit the single selected text-editable object.
      if (e.key === 'Enter') {
        if (selection.ids.size !== 1 || !canEdit) return;
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (obj === undefined || getObjectType(obj.type)?.editableText !== true) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
