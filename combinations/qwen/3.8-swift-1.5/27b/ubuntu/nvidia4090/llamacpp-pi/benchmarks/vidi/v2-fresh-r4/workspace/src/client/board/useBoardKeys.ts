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
  /** Undo (Ctrl/Cmd+Z) — story 8. */
  onUndo?(): void;
  /** Redo (Ctrl/Cmd+Shift+Z, Ctrl+Y) — story 8. */
  onRedo?(): void;
  /** Close the current undo step before a discrete action — story 8. */
  onBoundary?(): void;
}

/**
 * Window keyboard handler for selection commands:
 * - Ctrl/Cmd+A: select all
 * - Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z / Ctrl+Y: redo (story 8)
 * - Escape: clear selection
 * - Arrow keys: nudge selection (nudges within the capture timeout merge
 *   into one undo step)
 * - Delete/Backspace: delete selection (its own undo step)
 *
 * Ignored when editing text or focus is in an input/textarea.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit, onUndo, onRedo, onBoundary } = opts;

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

      // Undo / redo shortcuts (story 8)
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo?.();
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

        // Delete/Backspace: delete selection (its own undo step)
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onBoundary?.();
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
