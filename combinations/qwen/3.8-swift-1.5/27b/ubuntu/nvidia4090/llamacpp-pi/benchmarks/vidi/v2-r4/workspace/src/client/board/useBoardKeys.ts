import { useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const { doc, selection, snapshot, canEdit } = opts;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if editing text
      if (selection.editingId) return;

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl/Cmd+A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: Clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys: Nudge selection
      if (selection.ids.size > 0 && canEdit) {
        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (arrows.includes(e.key)) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;

          const positions = new Map<string, { x: number; y: number }>();
          for (const obj of snapshot) {
            if (selection.ids.has(obj.id)) {
              let dx = 0, dy = 0;
              if (e.key === 'ArrowUp') dy = -step;
              if (e.key === 'ArrowDown') dy = step;
              if (e.key === 'ArrowLeft') dx = -step;
              if (e.key === 'ArrowRight') dx = step;
              positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          moveObjects(doc, positions);
          return;
        }

        // Delete/Backspace: Delete selection
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteObjects(doc, [...selection.ids]);
          selection.clear();
          return;
        }
      }
    },
    [doc, selection, snapshot, canEdit],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
