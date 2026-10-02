import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects, objectBounds } from '../../shared/board-model';
import type { UseSelectionResult } from './useSelection';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';

export interface UseBoardKeysOptions {
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

export function useBoardKeys(opts: UseBoardKeysOptions): void {
  const stateRef = useRef(opts);
  stateRef.current = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = stateRef.current;

      // Ignore when editing text or focused on an input
      if (selection.editingId || isTextEntry(e.target)) return;

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

      // Arrow keys: nudge selection
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selection.ids.size > 0) {
        if (!canEdit) return;
        e.preventDefault(); // prevent page scroll
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        switch (e.key) {
          case 'ArrowRight': dx = step; break;
          case 'ArrowLeft': dx = -step; break;
          case 'ArrowDown': dy = step; break;
          case 'ArrowUp': dy = -step; break;
        }
        const positions = new Map<string, Point>();
        for (const id of selection.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (obj) {
            positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) moveObjects(doc, positions);
        return;
      }

      // Delete/Backspace: delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.ids.size > 0) {
        if (!canEdit) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
