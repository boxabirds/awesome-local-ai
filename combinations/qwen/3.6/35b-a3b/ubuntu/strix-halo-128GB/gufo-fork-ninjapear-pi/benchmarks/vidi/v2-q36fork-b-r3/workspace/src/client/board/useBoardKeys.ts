import { useEffect } from 'react';
import * as Y from 'yjs';
import type { StickySnapshot } from '@shared/board-model';
import { deleteObjects, moveObjects, allObjectIds } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';

interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: ReturnType<typeof import('./useSelection').useSelection>;
  snapshot: readonly StickySnapshot[];
  canEdit: boolean;
}

/** Handle keyboard shortcuts for selection management. */
export function useBoardKeys({ doc, selection, snapshot, canEdit }: UseBoardKeysOpts) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in input/textarea/select or editing text
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (selection.editingId !== null) return;

      // Ctrl/Cmd+A — select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        if (ids.length > 0) {
          selection.setMany(ids, false);
        } else {
          selection.clear();
        }
        return;
      }

      // Escape — clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        selection.clear();
        return;
      }

      // Arrow keys — nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selection.ids.size > 0) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case 'ArrowRight': dx = step; break;
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowDown': dy = step; break;
            case 'ArrowUp': dy = -step; break;
          }
          if (dx !== 0 || dy !== 0 && canEdit) {
            const positions = new Map<string, { x: number; y: number }>();
            for (const s of snapshot) {
              if (selection.ids.has(s.id)) {
                positions.set(s.id, { x: s.x + dx, y: s.y + dy });
              }
            }
            moveObjects(doc, positions);
          }
        }
        return;
      }

      // Delete / Backspace — delete selected objects
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.ids.size > 0) {
        e.preventDefault();
        if (canEdit) {
          const idList = [...selection.ids];
          deleteObjects(doc, idList);
          selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit]);
}
