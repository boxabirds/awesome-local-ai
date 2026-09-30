import { useEffect } from 'react';
import type * as Y from 'yjs';

import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
  type Point,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { isTextEntryTarget, type SelectionApi } from './useSelection';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/**
 * Window-level keyboard handler for selection commands:
 * - Ctrl/Cmd+A: select all
 * - Escape: clear selection
 * - Arrow keys: nudge selection
 * - Delete/Backspace: delete selection
 *
 * Does nothing when focus is in an input/textarea or when editing text.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit } = opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { ids, editingId, setMany, clear, startEdit } = selection;

      // If editing text or focus is in a text input, let the input handle it
      if (editingId !== null || isTextEntryTarget(event.target)) return;

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        const allIds = allObjectIds(snapshot);
        setMany(allIds, false);
        return;
      }

      // Escape: clear selection
      if (event.key === 'Escape') {
        clear();
        return;
      }

      // Enter: edit the single selected sticky
      if (event.key === 'Enter') {
        if (ids.size === 1) {
          const id = [...ids][0]!;
          const obj = snapshot.find((o) => o.id === id);
          if (obj?.type === 'sticky') {
            event.preventDefault();
            startEdit(id);
          }
        }
        return;
      }

      // Arrow keys: nudge
      if (
        ids.size > 0 &&
        canEdit &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = -step;
        else if (event.key === 'ArrowRight') dx = step;
        else if (event.key === 'ArrowUp') dy = -step;
        else if (event.key === 'ArrowDown') dy = step;

        const positions = new Map<string, Point>();
        for (const objId of ids) {
          const obj = snapshot.find((o) => o.id === objId);
          if (obj) {
            positions.set(objId, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (
        ids.size > 0 &&
        canEdit &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        deleteObjects(doc, [...ids]);
        clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit]);
}
