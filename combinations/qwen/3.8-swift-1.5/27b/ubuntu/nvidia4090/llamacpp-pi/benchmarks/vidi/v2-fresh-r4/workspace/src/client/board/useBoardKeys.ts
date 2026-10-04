import { useEffect } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/**
 * Window keyboard handler for selection commands:
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 *
 * Ignored when editing text or focus is in an input/textarea.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit } = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // Ignore when editing text or focus is in an input
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (selection.editingId) return;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys: nudge (only when canEdit and there's a selection)
      if (canEdit && selection.ids.size > 0) {
        const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (arrowKeys.includes(e.key)) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowUp') dy = -step;
          if (e.key === 'ArrowDown') dy = step;
          if (e.key === 'ArrowLeft') dx = -step;
          if (e.key === 'ArrowRight') dx = step;

          const positions = new Map<string, { x: number; y: number }>();
          for (const obj of snapshot) {
            if (selection.ids.has(obj.id)) {
              positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          moveObjects(doc, positions);
          return;
        }

        // Delete/Backspace: delete selection
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteObjects(doc, [...selection.ids]);
          selection.clear();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [doc, selection, snapshot, canEdit]);
}
