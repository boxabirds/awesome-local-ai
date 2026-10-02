import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

/**
 * Story 7: the board keyboard shortcuts (sel.keyboard):
 * - Escape: clear the selection.
 * - Ctrl/Cmd+A: select all objects on the board.
 * - Arrow keys: nudge the selection by NUDGE_STEP_WORLD (Shift: ×10).
 * - Delete/Backspace: delete the selection.
 * - Enter: start editing a single selected, text-editable object.
 *
 * All shortcuts are ignored while typing in a field (textarea/input/
 * contenteditable) — the text editor owns those keys.
 */
export interface BoardKeysOptions {
  doc: Y.Doc;
  objects: readonly ObjectSnapshot[];
  selection: Selection;
  canEdit: boolean;
}

export function useBoardKeys({ doc, objects, selection, canEdit }: BoardKeysOptions): void {
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable);
      if (inField) return;

      const sel = selectionRef.current;
      const objs = objectsRef.current;
      const d = docRef.current;
      const editable = canEditRef.current;

      if (e.key === 'Escape') {
        sel.clear();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        sel.setMany(allObjectIds(objs), false);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.size > 0 && editable && sel.editingId === null) {
          e.preventDefault();
          deleteObjects(d, [...sel.ids]);
        }
        return;
      }
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        if (sel.size > 0 && editable && sel.editingId === null) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const positions = new Map<string, { x: number; y: number }>();
          for (const o of objs) {
            if (!sel.ids.has(o.id)) continue;
            positions.set(o.id, { x: o.x + dx, y: o.y + dy });
          }
          moveObjects(d, positions);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (sel.size === 1 && sel.editingId === null && editable) {
          const id = [...sel.ids][0];
          const obj = objs.find((o) => o.id === id);
          const spec = obj ? getObjectType(obj.type) : undefined;
          if (spec?.editableText) {
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
