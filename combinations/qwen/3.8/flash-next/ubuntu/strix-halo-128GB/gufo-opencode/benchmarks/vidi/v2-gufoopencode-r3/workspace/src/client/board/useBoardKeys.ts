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
}

// Window-level selection keyboard commands: Ctrl/Cmd+A select all, Escape
// clear, arrows nudge, Delete/Backspace delete, Enter edits a single sticky.
export function useBoardKeys({ doc, objects, selection, canEdit }: BoardKeysOptions): void {
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
        moveObjects(doc, positions);
        return;
      }
      if (canEdit && (key === 'Delete' || key === 'Backspace')) {
        e.preventDefault();
        deleteObjects(doc, [...ids]);
        selection.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, objects, selection, ids, editingId, canEdit]);
}
