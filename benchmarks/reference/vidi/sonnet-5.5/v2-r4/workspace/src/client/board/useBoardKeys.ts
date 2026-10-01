import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/** Select all, clear, nudge and delete; Enter starts editing a single selected note. Ignored while typing. */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = ref.current;
      if (selection.editingId !== null || isTextTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        selection.clear();
        return;
      }
      if (selection.ids.size === 0) return;
      const ids = [...selection.ids];

      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault(); // no page scroll, no board pan
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const o of snapshot) if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + arrow[0] * step, y: o.y + arrow[1] * step });
        moveObjects(doc, positions);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        deleteObjects(doc, ids);
        selection.clear();
      } else if (e.key === 'Enter' && ids.length === 1 && canEdit && getObjectType(snapshot.find((o) => o.id === ids[0])?.type ?? '')?.editableText) {
        if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        selection.startEdit(ids[0]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
