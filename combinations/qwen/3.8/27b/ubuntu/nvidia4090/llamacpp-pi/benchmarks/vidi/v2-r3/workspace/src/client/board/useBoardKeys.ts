import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { UndoController } from './undo';
import type { SelectionApi } from './useSelection';

/**
 * Story 7 (sel.keyboard): selection keyboard commands.
 *
 *   Ctrl/Cmd+A  select all (registered-type objects)
 *   Escape      clear the selection
 *   arrows      nudge the selection (Shift for the large step)
 *   Delete/⌫    delete the selection
 *   Enter       edit the single selected text object
 *   Ctrl/Cmd+Z  undo the caller's last change (story 8)
 *   Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y  redo (story 8)
 *
 * Ignored while editing text, while focus is in an input/textarea/content
 * element, or (for the mutating keys) when `canEdit` is false. Handled keys
 * call preventDefault (no page scroll, no text selection, no board pan).
 * An Escape already handled elsewhere (e.g. the marquee) is left alone via
 * defaultPrevented. Nudge and delete are wrapped in undo step boundaries.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo: UndoController;
}): void {
  const { doc, selection, canEdit, undo } = opts;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const sel = selectionRef.current;
      if (sel.editingId !== null) return; // text editing owns the keyboard
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable);
      if (inField) return;

      const mod = e.ctrlKey || e.metaKey;
      const snap = snapshotRef.current;

      // Select all.
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        sel.setMany(allObjectIds(snap), false);
        return;
      }
      // Clear.
      if (e.key === 'Escape') {
        e.preventDefault();
        sel.clear();
        return;
      }
      // Nudge.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (sel.ids.size === 0) return;
        if (!canEditRef.current) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const id of sel.ids) {
          const o = snap.find((s) => s.id === id);
          if (!o) continue;
          positions.set(id, { x: o.x + dx, y: o.y + dy });
        }
        undoRef.current.boundary();
        moveObjects(doc, positions);
        undoRef.current.boundary();
        return;
      }
      // Delete.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.ids.size === 0) return;
        if (!canEditRef.current) return;
        e.preventDefault();
        undoRef.current.boundary();
        deleteObjects(doc, [...sel.ids]);
        undoRef.current.boundary();
        sel.clear();
        return;
      }
      // Undo (story 8).
      if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (!canEditRef.current) return;
        e.preventDefault();
        undoRef.current.undo();
        return;
      }
      // Redo (story 8): Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y.
      if ((mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) || (mod && (e.key === 'y' || e.key === 'Y'))) {
        if (!canEditRef.current) return;
        e.preventDefault();
        undoRef.current.redo();
        return;
      }
      // Enter to edit the single selected text object.
      if (e.key === 'Enter') {
        if (sel.ids.size !== 1) return;
        if (!canEditRef.current) return;
        const id = [...sel.ids][0];
        const o = snap.find((s) => s.id === id);
        if (!o) return;
        if (!getObjectType(o.type)?.editableText) return;
        e.preventDefault();
        sel.startEdit(id);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
}
