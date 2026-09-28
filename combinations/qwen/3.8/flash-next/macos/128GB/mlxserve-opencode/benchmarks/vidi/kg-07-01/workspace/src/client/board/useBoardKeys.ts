import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { moveObjects, deleteObjects, allObjectIds, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export interface BoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/**
 * Keyboard commands for selection: Ctrl/Cmd+A, Escape, arrow nudge, Delete/Backspace.
 */
export function useBoardKeys(opts: BoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;

      // Ignore when editing text or focused in a text field.
      if (selection.editingId !== null || isTextField(e.target)) return;

      const hasSelection = selection.ids.size > 0;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        if (hasSelection) selection.clear();
        return;
      }

      // Arrow keys: nudge selection
      if (hasSelection && canEdit) {
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = 1;
        else if (e.key === 'ArrowLeft') dx = -1;
        else if (e.key === 'ArrowDown') dy = 1;
        else if (e.key === 'ArrowUp') dy = -1;

        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          const positions = new Map<string, { x: number; y: number }>();
          for (const id of selection.ids) {
            const obj = snapshot.find((o) => o.id === id);
            if (!obj) continue;
            positions.set(id, { x: obj.x + dx * step, y: obj.y + dy * step });
          }
          if (positions.size > 0) moveObjects(doc, positions);
          return;
        }
      }

      // Delete/Backspace: delete selection
      if (hasSelection && canEdit && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
