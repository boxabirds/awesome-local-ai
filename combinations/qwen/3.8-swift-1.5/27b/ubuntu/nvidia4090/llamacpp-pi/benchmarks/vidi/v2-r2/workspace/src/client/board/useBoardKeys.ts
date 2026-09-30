import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';
import type { Point } from '../canvas/camera';
import type { UndoController } from './undo';

/**
 * Board keyboard shortcuts (story 7, sel.keys), active when not editing and
 * the focus is not in an input/contenteditable:
 *
 *   Ctrl/Cmd+A      select all          (preventDefault)
 *   Escape          clear the selection
 *   Arrow keys      nudge selection ±NUDGE_STEP (±NUDGE_LARGE with Shift)
 *                   (preventDefault — never scrolls the page)
 *   Delete/Backspace delete the selection
 *   Enter           start editing a single text-editable selection
 *
 * Nudge and delete require the editable (connected) state; selection changes
 * (select-all, clear) work whenever.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController;
}): void {
  const { doc, selection, snapshot, canEdit, undoController } = opts;
  const stateRef = useRef({ doc, selection, snapshot, canEdit, undoController });
  stateRef.current = { doc, selection, snapshot, canEdit, undoController };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { doc: d, selection: sel, snapshot: snap, canEdit: editable, undoController: uc } = stateRef.current;

      // Never hijack keys while editing text (board-level or page-level).
      if (sel.editingId !== null) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      // Undo: Ctrl/Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (!editable || !uc) return;
        e.preventDefault();
        uc.undo();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (!editable || !uc) return;
        e.preventDefault();
        uc.redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        if (!editable || !uc) return;
        e.preventDefault();
        uc.redo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        sel.setMany(allObjectIds(snap), false);
        return;
      }

      if (e.key === 'Escape') {
        sel.clear();
        return;
      }

      if (sel.ids.size === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!editable) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const obj of snap) {
          if (sel.ids.has(obj.id)) positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
        }
        moveObjects(d, positions);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editable) return;
        e.preventDefault();
        deleteObjects(d, [...sel.ids]);
        sel.clear();
        return;
      }

      if (e.key === 'Enter') {
        if (!editable) return;
        if (sel.ids.size === 1) {
          const id = [...sel.ids][0];
          const obj = snap.find((o) => o.id === id);
          if (obj && getObjectType(obj.type)?.editableText) {
            e.preventDefault();
            sel.startEdit(id);
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
