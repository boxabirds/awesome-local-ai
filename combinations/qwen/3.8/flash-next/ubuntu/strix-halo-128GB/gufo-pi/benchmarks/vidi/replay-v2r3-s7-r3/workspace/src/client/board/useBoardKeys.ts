import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { moveObjects, deleteObjects, allObjectIds } from '../../shared/board-model';
import type { UseSelectionResult } from './useSelection';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: UseSelectionResult;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

/** True when the key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Window keydown handler for board selection commands:
 * Ctrl/Cmd+A, Escape, arrows (nudge), Delete/Backspace.
 * Ignores keys when editing text or focus is in an input.
 */
export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;

      // Ignore when editing text or focus is in an input/textarea
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

      // Arrow keys: nudge selection (requires canEdit and non-empty selection)
      if (
        canEdit &&
        selection.ids.size > 0 &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = step;
        else if (e.key === 'ArrowLeft') dx = -step;
        else if (e.key === 'ArrowDown') dy = step;
        else if (e.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const id of selection.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (obj) {
            positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          moveObjects(doc, positions);
        }
        return;
      }

      // Delete/Backspace: delete selection (requires canEdit and non-empty selection)
      if (
        canEdit &&
        selection.ids.size > 0 &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        e.preventDefault();
        deleteObjects(doc, Array.from(selection.ids));
        selection.clear();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
