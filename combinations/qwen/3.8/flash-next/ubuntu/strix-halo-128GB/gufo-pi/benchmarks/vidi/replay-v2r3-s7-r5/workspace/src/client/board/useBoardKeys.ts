import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects, objectBounds } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Window-level keyboard handler for selection commands:
 * Ctrl/Cmd+A, Escape, arrows, Delete/Backspace, Enter-to-edit.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit } = opts;
  const ref = useRef({ doc, selection, snapshot, canEdit });
  ref.current = { doc, selection, snapshot, canEdit };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { doc: d, selection: sel, snapshot: snap, canEdit: edit } = ref.current;

      // Ignore when editing text or focus is in a text field
      if (sel.editingId || isTextEntry(e.target)) return;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
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

      // Arrow keys: nudge selection
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && sel.ids.size > 0) {
        if (!edit) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowDown') dy = step;
        else if (e.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snap) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) moveObjects(d, positions);
        return;
      }

      // Delete/Backspace: delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.ids.size > 0) {
        if (!edit) return;
        e.preventDefault();
        const ids = [...sel.ids];
        deleteObjects(d, ids);
        sel.clear();
        return;
      }

      // Enter: start editing if exactly one sticky selected
      if (e.key === 'Enter' && sel.ids.size === 1) {
        if (!edit) return;
        const id = [...sel.ids][0];
        const obj = snap.find((o) => o.id === id);
        if (obj && obj.type === 'sticky') {
          e.preventDefault();
          sel.startEdit(id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
