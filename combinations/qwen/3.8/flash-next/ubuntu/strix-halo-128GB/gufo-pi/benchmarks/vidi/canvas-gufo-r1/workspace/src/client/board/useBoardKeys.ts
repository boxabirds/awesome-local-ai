import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';
import type { UndoController } from './undo';

export interface UseBoardKeysOptions {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undoController?: UndoController | null;
}

function isEditingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Global keyboard commands for the board:
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 * - Ctrl/Cmd+Z: undo
 * - Ctrl/Cmd+Shift+Z or Ctrl+Y: redo
 */
export function useBoardKeys(opts: UseBoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit, undoController } = opts;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      const snap = snapshotRef.current;
      const isMod = e.ctrlKey || e.metaKey;

      // Undo/Redo shortcuts (handled before editing guards)
      if (isMod && e.key === 'z' && !e.shiftKey) {
        // Ctrl/Cmd+Z: undo
        // If editing in a sticky, let the editor handle it
        if (sel.editingId !== null) return;
        if (isEditingContext(e.target)) return;
        e.preventDefault();
        if (!canEditRef.current) return;
        const ctrl = undoRef.current;
        if (ctrl) ctrl.undo();
        return;
      }

      if (isMod && e.key === 'z' && e.shiftKey) {
        // Ctrl/Cmd+Shift+Z: redo
        if (sel.editingId !== null) return;
        if (isEditingContext(e.target)) return;
        e.preventDefault();
        if (!canEditRef.current) return;
        const ctrl = undoRef.current;
        if (ctrl) ctrl.redo();
        return;
      }

      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        // Ctrl+Y: redo
        if (sel.editingId !== null) return;
        if (isEditingContext(e.target)) return;
        e.preventDefault();
        if (!canEditRef.current) return;
        const ctrl = undoRef.current;
        if (ctrl) ctrl.redo();
        return;
      }

      // Ignore when editing text or focus is in an input
      if (sel.editingId !== null) return;
      if (isEditingContext(e.target)) return;

      // Ctrl/Cmd+A: select all
      if (isMod && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snap);
        sel.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        sel.clear();
        return;
      }

      // The following keys require a selection and canEdit
      if (sel.ids.size === 0) return;
      if (!canEditRef.current) return;

      // Arrow keys: nudge
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const id of sel.ids) {
          const obj = snap.find((o) => o.id === id);
          if (!obj) continue;
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const ids = [...sel.ids];
        deleteObjects(doc, ids);
        sel.clear();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc]);
}
