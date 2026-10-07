import { useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { moveObjects, deleteObjects, allObjectIds } from '@/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@/shared/config';
import type { ObjectSnapshot } from '@/client/objects/registry';

interface UseBoardKeysOptions {
  doc: Y.Doc;
  selectedIds: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  isEditing: boolean;
  setMany(ids: string[], additive: boolean): void;
  clear(): void;
}

/**
 * Handles keyboard shortcuts for selection: select-all, clear, nudge, delete.
 * Ignored when editing text or focus is in input/textarea.
 */
export function useBoardKeys({
  doc,
  selectedIds,
  snapshot,
  canEdit,
  isEditing,
  setMany,
  clear: clearSelection,
}: UseBoardKeysOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore when typing in a note or other input element
      if (isEditing) return;
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;

      // Ctrl/Cmd + A → select all objects
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = allObjectIds(snapshot);
        setMany(allIds, false);
        return;
      }

      // Escape → clear selection
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      // Arrow keys → nudge selection
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.size > 0) {
        e.preventDefault();
        if (!canEdit) return;

        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0;
        let dy = 0;

        switch (e.key) {
          case 'ArrowUp': dy = -step; break;
          case 'ArrowDown': dy = step; break;
          case 'ArrowLeft': dx = -step; break;
          case 'ArrowRight': dx = step; break;
        }

        const positions = new Map<string, { x: number; y: number }>();
        for (const snap of snapshot) {
          if (!selectedIds.has(snap.id)) continue;
          positions.set(snap.id, { x: snap.x + dx, y: snap.y + dy });
        }

        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete / Backspace → delete selection
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        if (!canEdit) return;

        const idsToDelete = Array.from(selectedIds);
        deleteObjects(doc, idsToDelete);
        clearSelection();
      }
    },
    [doc, selectedIds, snapshot, canEdit, isEditing, setMany, clearSelection],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
