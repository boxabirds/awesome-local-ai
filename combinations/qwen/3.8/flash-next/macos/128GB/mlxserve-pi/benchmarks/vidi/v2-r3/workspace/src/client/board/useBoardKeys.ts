import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { deleteObjects, moveObjects, objectBounds, allObjectIds } from '../../shared/board-model';
import type { SelectionApi } from './useSelection';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/** Is the keyboard focus inside something that owns Delete/Backspace/Enter? */
function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Board-wide keyboard commands for multi-selection:
 * - Ctrl/Cmd+A → select all
 * - Escape → clear selection
 * - Arrow keys → nudge selected objects
 * - Delete/Backspace → delete selected objects
 * - Enter → edit single selected sticky (handled in Board.tsx)
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;

      // When editing text or focus is in an input, don't intercept.
      if (selection.editingId !== null || isTextTarget(e.target)) return;

      // Ctrl/Cmd+A → select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.altKey) {
        e.preventDefault();
        const ids = allObjectIds(snapshot);
        selection.setMany(ids, false);
        return;
      }

      // Escape → clear selection
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      // Arrow keys → nudge (only when selection is non-empty and canEdit)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        e.preventDefault(); // no page scroll, no board pan

        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        // Build absolute positions: current position + delta
        const positions = new Map<string, { x: number; y: number }>();
        for (const id of selection.ids) {
          const obj = snapshot.find((s) => s.id === id);
          if (obj === undefined) continue;
          positions.set(id, { x: obj.x + dx, y: obj.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete/Backspace → delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        if (!canEdit) return;
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
