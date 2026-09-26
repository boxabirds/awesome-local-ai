import { useEffect, useRef } from 'react';
import type { Doc } from 'yjs';

import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';

export interface BoardKeyHandlers {
  ids: ReadonlySet<string>;
  setMany(ids: readonly string[], additive: boolean): void;
  clear(): void;
}

export interface BoardKeysOptions {
  doc: Doc;
  snapshot: readonly ObjectSnapshot[];
  selection: BoardKeyHandlers;
  editingId: string | null;
  canEdit: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Board-level keyboard shortcuts for multi-select editing (story 7):
 * select-all, clear, arrow-key nudge and delete. Every handler is ignored while
 * editing text or when focus is in a field, so typing is never hijacked.
 */
export function useBoardKeys(options: BoardKeysOptions): void {
  const ref = useRef(options);
  useEffect(() => {
    ref.current = options;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, snapshot, selection, editingId, canEdit } = ref.current;

      // Never intercept text entry or an active editor.
      if (editingId !== null) return;
      if (isEditableTarget(event.target)) return;

      // Select all (Ctrl/Cmd + A) and Escape are local, so they work on a
      // locked board too.
      const selectAll = (event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A');
      if (selectAll) {
        event.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (event.key === 'Escape') {
        selection.clear();
        return;
      }

      if (!canEdit) return;
      if (selection.ids.size === 0) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObjects(doc, Array.from(selection.ids));
        selection.clear();
        return;
      }

      const arrow = ARROWS[event.key];
      if (arrow !== undefined) {
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const [ux, uy] = arrow;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshot) {
          if (selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + ux * step, y: obj.y + uy * step });
          }
        }
        moveObjects(doc, positions);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
