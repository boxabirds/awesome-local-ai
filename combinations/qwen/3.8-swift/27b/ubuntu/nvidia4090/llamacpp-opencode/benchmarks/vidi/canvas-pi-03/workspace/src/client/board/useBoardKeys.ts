/**
 * Story 7: board-level keyboard shortcuts (sel.keyboard).
 *
 * - Ctrl/Cmd+A  → select every object on the board (all registered types)
 * - Escape      → clear the selection (editing exits first via the editor)
 * - Arrow keys  → nudge the selection by NUDGE_STEP_WORLD (Shift = ×10);
 *                 only with a selection and only when the board is editable
 * - Delete/Backspace → delete the selected objects; the selection is cleared
 * - Enter       → start editing a single selected editable-text object
 *                 (the story 2 behavior, unchanged for sticky notes)
 *
 * Shortcuts never fire while focus is inside a text input/textarea/content-
 * editable (typing a note), and never fire while an object is in editing
 * state (the editor's own key handling wins; it ends editing on Escape/blur).
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  moveObjects,
  deleteObjects,
  type ObjectSnapshot,
} from 'src/shared/board-model';
import { getObjectType } from '../objects/registry';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from 'src/shared/config';
import type { Selection } from './useSelection';

/** True when the event target is a text-control-like element. */
function focusIsInTextControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      if (focusIsInTextControl(e.target)) return;
      if (selection.editingId !== null) return;

      // Select all (works even without a current selection).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      if (!canEdit) return;

      // Nudge.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, { x: number; y: number }>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete / Backspace: remove the selected objects.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      // Enter: edit a single selected editable-text object.
      if (e.key === 'Enter') {
        if (selection.ids.size !== 1) return;
        const id = [...selection.ids][0];
        const obj = snapshot.find((o) => o.id === id);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (!spec || !spec.editableText) return;
        e.preventDefault();
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
