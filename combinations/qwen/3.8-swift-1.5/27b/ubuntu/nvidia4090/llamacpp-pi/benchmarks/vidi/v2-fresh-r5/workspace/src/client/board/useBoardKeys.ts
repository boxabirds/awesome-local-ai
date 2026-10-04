import { useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import {
  allObjectIds,
  moveObjects,
  deleteObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: {
    ids: ReadonlySet<string>;
    editingId: string | null;
    setMany: (ids: string[], additive: boolean) => void;
    clear: () => void;
    startEdit: (id: string) => void;
  };
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/**
 * Window keyboard handler for board-level commands:
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 * - Enter: start editing single selected sticky
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit } = opts;

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ignore if editing a note
      if (selection.editingId !== null) return;

      const hasSelection = selection.ids.size > 0;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(doc);
        selection.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys: nudge
      if (hasSelection && canEdit) {
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
          for (const id of selection.ids) {
            const obj = snapshot.find((o) => o.id === id);
            if (obj) {
              positions.set(id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          moveObjects(doc, positions);
          return;
        }
      }

      // Delete/Backspace: delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection && canEdit) {
        e.preventDefault();
        deleteObjects(doc, Array.from(selection.ids));
        selection.clear();
        return;
      }

      // Enter: start editing single selected sticky
      if (e.key === 'Enter' && selection.ids.size === 1 && canEdit) {
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (obj && obj.type === 'sticky') {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    },
    [doc, selection, snapshot, canEdit],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);
}
