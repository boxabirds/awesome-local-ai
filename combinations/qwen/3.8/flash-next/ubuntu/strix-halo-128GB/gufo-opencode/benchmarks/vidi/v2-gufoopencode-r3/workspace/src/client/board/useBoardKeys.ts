import { useEffect } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot
} from '../../shared/board-model';
import type { Point } from '../../shared/geometry';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { SelectionController } from './useSelection';
import type { UndoController } from './undo';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  selection: SelectionController;
  // False on a load-failed board: destructive keys are inert (TC-23).
  canEdit: boolean;
  // This tab's undo history. Absent means undo/redo keys are left alone.
  undo?: UndoController;
}

// Window-level selection keyboard commands: Ctrl/Cmd+A select all, Escape
// clear, arrows nudge, Delete/Backspace delete, Enter edits a single sticky,
// Ctrl/Cmd+Z undo and Ctrl/Cmd+Shift+Z / Ctrl+Y redo (story 8).
export function useBoardKeys({ doc, objects, selection, canEdit, undo }: BoardKeysOptions): void {
  const { ids, editingId } = selection;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (editingId !== null) return; // the editor owns keys while editing
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && (key === 'a' || key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(objects), false);
        return;
      }
      if (canEdit && undo !== undefined && (key === 'z' || key === 'Z') && (e.ctrlKey || e.metaKey)) {
        // Redo is Shift+Z; an empty stack leaves the browser default alone.
        const direction = e.shiftKey ? 'redo' : 'undo';
        const available = direction === 'redo' ? undo.canRedo() : undo.canUndo();
        if (!available) return;
        e.preventDefault();
        if (direction === 'redo') undo.redo();
        else undo.undo();
        return;
      }
      if (canEdit && undo !== undefined && e.ctrlKey && (key === 'y' || key === 'Y')) {
        if (!undo.canRedo()) return;
        e.preventDefault();
        undo.redo();
        return;
      }
      if (key === 'Escape') {
        selection.clear();
        return;
      }
      if (ids.size === 0) return;
      if (key === 'Enter') {
        if (!canEdit) return;
        if (ids.size !== 1) return;
        const id = [...ids][0];
        const obj = objects.find((o) => o.id === id);
        if (obj !== undefined && getObjectType(obj.type)?.editableText === true) {
          e.preventDefault();
          selection.startEdit(id);
        }
        return;
      }
      if (
        canEdit &&
        (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown')
      ) {
        // Always consume arrow keys while a selection exists: no page scroll
        // and no viewport pan (TC-29/TC-34).
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const obj of objects) {
          if (!ids.has(obj.id)) continue;
          positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
        }
        // One nudge is one undo step, never merged with its neighbours.
        undo?.boundary();
        moveObjects(doc, positions);
        undo?.boundary();
        return;
      }
      if (canEdit && (key === 'Delete' || key === 'Backspace')) {
        e.preventDefault();
        undo?.boundary();
        deleteObjects(doc, [...ids]);
        selection.clear();
        undo?.boundary();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, objects, selection, ids, editingId, canEdit]);
}
