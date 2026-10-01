import { useEffect, useCallback } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { UseSelectionResult } from './useSelection';
import type { UndoController } from './undo';

export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Per-user undo controller (story 8): boundaries + undo/redo shortcuts. */
  undo?: Pick<UndoController, 'boundary' | 'undo' | 'redo'>;
}): void {
  const { doc, selection, snapshot, canEdit, undo } = opts;

  // Each key-driven board mutation is a discrete gesture: close the capture
  // window before and after so it never merges with a neighbouring change.
  const runBounded = useCallback(
    (fn: () => void) => {
      undo?.boundary();
      fn();
      undo?.boundary();
    },
    [undo],
  );

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

      // Ctrl/Cmd+Z: undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo (story 8).
      // Only for editable sessions; the guards above already skip text
      // editing and input/textarea focus (TC-21).
      if (canEdit && undo && (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (e.shiftKey) {
          undo.redo();
        } else {
          undo.undo();
        }
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
          runBounded(() => moveObjects(doc, positions));
          return;
        }

        // Delete/Backspace: Delete selection
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          runBounded(() => deleteObjects(doc, [...selection.ids]));
          selection.clear();
          return;
        }
      }
    },
    [doc, selection, snapshot, canEdit, undo, runBounded],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
