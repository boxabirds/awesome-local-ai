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
  /** Activate the text tool (T) or the select tool (V, Escape) — story 9. */
  onActivateTextTool?(active: boolean): void;
  /** Create a sticky note at the board centre (N) — story 9. */
  onCreateStickyNote?(): void;
}

/**
 * Window keyboard handler for selection commands:
 * - Ctrl/Cmd+A: select all
 * - Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z / Ctrl+Y: redo (story 8)
 * - Escape: clear selection
 * - Arrow keys: nudge selection (nudges within the capture timeout merge
 *   into one undo step)
 * - Delete/Backspace: delete selection (its own undo step)
 * - T: activate the text tool; V / Escape: select tool (story 9)
 * - N: create a sticky note at the board centre (story 9)
 *
 * Ignored when editing text or focus is in an input/textarea.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const { doc, selection, snapshot, canEdit, onUndo, onRedo, onBoundary, onActivateTextTool, onCreateStickyNote } = opts;

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

      // Escape: clear selection (also deactivates the text tool)
      if (e.key === 'Escape') {
        selection.clear();
        onActivateTextTool?.(false);
        return;
      }

      // T: activate the text tool; V: select tool (story 9)
      if (!mod && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        onActivateTextTool?.(true);
        return;
      }
      if (!mod && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        onActivateTextTool?.(false);
        return;
      }
      // N: create a sticky note at the board centre (story 9)
      if (!mod && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onCreateStickyNote?.();
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
