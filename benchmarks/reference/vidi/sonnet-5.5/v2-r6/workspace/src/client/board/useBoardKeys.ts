import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds, deleteObjects, moveObjects, objectBounds, snapshot as readSnapshot, type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { useSelection } from './useSelection';

const TEXT_INPUT = 'input, textarea, select, [contenteditable]';
const ANY_CONTROL = `${TEXT_INPUT}, button`;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** Select all, clear, nudge, delete (and Enter to edit a single selected note) on the window. */
export function useBoardKeys(opts: {
  doc: Y.Doc; selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[]; canEdit: boolean;
}): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = latest.current;
      if (selection.editingId !== null) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TEXT_INPUT)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }
      if (selection.ids.size === 0) return;

      if (e.key === 'Enter') {
        if (!canEdit || selection.ids.size !== 1 || target?.closest(ANY_CONTROL)) return;
        e.preventDefault();
        selection.startEdit([...selection.ids][0]);
        return;
      }
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const next = new Map<string, { x: number; y: number }>();
        for (const o of readSnapshot(doc)) {
          if (!selection.ids.has(o.id)) continue;
          const b = objectBounds(o);
          next.set(o.id, { x: b.x + arrow[0] * step, y: b.y + arrow[1] * step });
        }
        moveObjects(doc, next);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
