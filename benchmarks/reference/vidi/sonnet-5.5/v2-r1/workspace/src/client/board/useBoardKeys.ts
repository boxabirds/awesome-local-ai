import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Select all, clear, nudge, delete and Enter-to-edit. Text being edited keeps every key. */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const live = useRef(opts);
  live.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = live.current;
      if (selection.editingId !== null || isTypingTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot, (t) => getObjectType(t) !== undefined), false);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        selection.clear();
        return;
      }
      if (selection.ids.size === 0) return;

      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) {
            const b = objectBounds(o);
            positions.set(o.id, { x: b.x + arrow.x * step, y: b.y + arrow.y * step });
          }
        }
        moveObjects(doc, positions);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (!canEdit) return;
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
      } else if (e.key === 'Enter' && selection.ids.size === 1) {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON' || !canEdit) return;
        const only = snapshot.find((o) => selection.ids.has(o.id));
        if (only && getObjectType(only.type)?.editableText) {
          e.preventDefault();
          selection.startEdit(only.id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
