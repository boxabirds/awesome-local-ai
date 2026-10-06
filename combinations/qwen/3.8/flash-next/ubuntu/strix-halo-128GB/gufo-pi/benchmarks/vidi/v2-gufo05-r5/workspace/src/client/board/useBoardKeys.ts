/**
 * Board keyboard commands (story 7): select all, clear, nudge, delete.
 *
 * Mounted once per board; attaches a window-level keydown listener.
 * Ignores keys when focus is in a text input or when editing text.
 */
import { useEffect } from 'react';
import * as Y from 'yjs';
import {
  moveObjects,
  deleteObjects,
  allObjectIds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { SelectionController } from './useSelection';

/** True when the keyboard belongs to a text field, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionController;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const { doc, selection, snapshot, canEdit } = opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never intercept when typing in a field
      if (selection.editingId !== null || isTextEntry(event.target)) return;
      if (event.defaultPrevented) return;

      // Ctrl/Cmd+A: select all
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'a') {
        event.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Ctrl/Cmd shortcuts are for zoom, not our business
      if (event.ctrlKey || event.metaKey) return;

      // Escape: clear selection
      if (event.key === 'Escape') {
        selection.clear();
        return;
      }

      // Enter: start editing a single selected sticky note
      if (event.key === 'Enter' && selection.ids.size === 1) {
        const id = [...selection.ids][0]!;
        const obj = snapshot.find((o) => o.id === id);
        if (obj && obj.type === 'sticky' && canEdit) {
          event.preventDefault();
          selection.startEdit(id);
          return;
        }
      }

      // Arrow keys: nudge
      if (selection.ids.size > 0 && canEdit) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          if (event.key === 'ArrowLeft') dx = -step;
          if (event.key === 'ArrowRight') dx = step;
          if (event.key === 'ArrowUp') dy = -step;
          if (event.key === 'ArrowDown') dy = step;

          const positions = new Map<string, { x: number; y: number }>();
          for (const id of selection.ids) {
            const obj = snapshot.find((o) => o.id === id);
            if (!obj) continue;
            positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
          if (positions.size > 0) {
            moveObjects(doc, positions);
          }
          return;
        }

        // Delete/Backspace: delete selection
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          deleteObjects(doc, [...selection.ids]);
          selection.clear();
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selection, snapshot, canEdit]);
}
