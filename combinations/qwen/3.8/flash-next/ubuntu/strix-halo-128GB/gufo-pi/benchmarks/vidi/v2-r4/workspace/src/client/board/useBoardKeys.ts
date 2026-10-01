/**
 * useBoardKeys: handles keyboard commands for selection — select all, clear,
 * nudge, delete, Enter-to-edit, and undo/redo.
 */
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo?: UndoController;
}

/** True when focus is in a text-editing element. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, undo } = opts;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const sel = selectionRef.current;
      const snap = snapshotRef.current;
      const ctrl = undoRef.current;

      // Undo/redo shortcuts (must be checked before text-entry guard for
      // the case where editingId is null but focus is on the board)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'z') {
        // If editing text, the editor handles it
        if (sel.editingId !== null) return;
        if (isTextEntry(event.target)) return;
        if (!canEditRef.current || !ctrl) return;
        event.preventDefault();
        ctrl.boundary();
        ctrl.undo();
        ctrl.boundary();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        if (sel.editingId !== null) return;
        if (isTextEntry(event.target)) return;
        if (!canEditRef.current || !ctrl) return;
        event.preventDefault();
        ctrl.boundary();
        ctrl.redo();
        ctrl.boundary();
        return;
      }

      // Ctrl+Y: redo (Windows convention)
      if (event.ctrlKey && !event.metaKey && event.key === 'y') {
        if (sel.editingId !== null) return;
        if (isTextEntry(event.target)) return;
        if (!canEditRef.current || !ctrl) return;
        event.preventDefault();
        ctrl.boundary();
        ctrl.redo();
        ctrl.boundary();
        return;
      }

      // If editing text, don't intercept
      if (sel.editingId !== null) return;
      if (isTextEntry(event.target)) return;

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const ids = allObjectIds(snap);
        sel.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (event.key === 'Escape') {
        sel.clear();
        return;
      }

      // Arrow keys: nudge selection
      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        sel.ids.size > 0
      ) {
        event.preventDefault();
        if (!canEditRef.current) return;
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        if (event.key === 'ArrowRight') dx = step;
        if (event.key === 'ArrowUp') dy = -step;
        if (event.key === 'ArrowDown') dy = step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snap) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete/Backspace: delete selection
      if ((event.key === 'Delete' || event.key === 'Backspace') && sel.ids.size > 0) {
        event.preventDefault();
        if (!canEditRef.current) return;
        deleteObjects(doc, [...sel.ids]);
        sel.clear();
        return;
      }

      // Enter: start editing single selected sticky note
      if (event.key === 'Enter' && sel.ids.size === 1) {
        const id = [...sel.ids][0]!;
        const obj = snap.find((o) => o.id === id);
        if (obj && obj.type === 'sticky') {
          event.preventDefault();
          sel.startEdit(id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);
}
