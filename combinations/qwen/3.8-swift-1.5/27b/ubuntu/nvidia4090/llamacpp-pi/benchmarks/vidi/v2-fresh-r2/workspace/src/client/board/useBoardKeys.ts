/**
 * Board keyboard commands (story 7, sel.all / sel.delete / sel.nudge;
 * story 8, undo.shortcuts).
 *
 * - Ctrl/Cmd+A → select all registered objects;
 * - Escape → clear the selection;
 * - arrows → nudge the selection by NUDGE_STEP_WORLD (Shift: ×10);
 * - Delete/Backspace → delete the selection;
 * - Enter → start editing the single selected text object;
 * - Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z or Ctrl+Y → redo.
 *
 * Ignored while focus is in a text field or while an object is being edited
 * (the editor owns its own keys, incl. Escape/Enter — story 2).
 */

import { useEffect, useRef } from 'react';
import type { Doc as YDoc } from 'yjs';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { Selection } from './useSelection';
import type { UndoController } from './undo';

export function useBoardKeys(opts: {
  doc: YDoc;
  objects: readonly ObjectSnapshot[];
  selection: Selection;
  canEdit: boolean;
  startEdit: (id: string) => void;
  undo?: UndoController;
}): void {
  const { doc, selection, startEdit } = opts;

  const objectsRef = useRef(opts.objects);
  objectsRef.current = opts.objects;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const startEditRef = useRef(startEdit);
  startEditRef.current = opts.startEdit;
  const undoRef = useRef(opts.undo);
  undoRef.current = opts.undo;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const sel = selectionRef.current;
      if (sel.editingId) return; // the editor owns the keys
      // Only the mutating keys are gated on canEdit (sel.keyboard).

      const objects = objectsRef.current;

      // Undo/Redo shortcuts (story 8)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!canEditRef.current) return;
        e.preventDefault();
        const ctrl = undoRef.current;
        if (!ctrl) return;
        if (e.shiftKey) {
          ctrl.redo();
        } else {
          ctrl.undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!canEditRef.current) return;
        e.preventDefault();
        undoRef.current?.redo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sel.setMany(allObjectIds(objects), false);
        return;
      }

      switch (e.key) {
        case 'Escape':
          if (sel.ids.size > 0) {
            e.preventDefault();
            sel.clear();
          }
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (sel.ids.size === 0 || !canEditRef.current) return;
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const positions = new Map<string, { x: number; y: number }>();
          for (const obj of objects) {
            if (sel.ids.has(obj.id)) positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
          moveObjects(doc, positions);
          return;
        }
        case 'Delete':
        case 'Backspace': {
          if (sel.ids.size === 0 || !canEditRef.current) return;
          e.preventDefault();
          deleteObjects(doc, [...sel.ids]);
          sel.clear();
          return;
        }
        case 'Enter': {
          if (sel.ids.size === 1) {
            const [id] = [...sel.ids];
            const obj = objects.find((o) => o.id === id);
            if (obj && obj.type === 'sticky') {
              e.preventDefault();
              startEditRef.current(id);
            }
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc]);
}
