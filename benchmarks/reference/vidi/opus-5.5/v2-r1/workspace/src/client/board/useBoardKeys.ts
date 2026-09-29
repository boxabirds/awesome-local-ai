// Board keyboard commands (story 7): Ctrl/Cmd+A select all, Escape clear, arrows nudge,
// Delete/Backspace delete, Enter edit a single selected note. Ignored while text is edited.
import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  type ObjectSnapshot,
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectsSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { isEditableTarget } from '../canvas/isEditableTarget';
import { getObjectType, isRegisteredType } from '../objects/registry';
import type { Selection } from './useSelection';

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      if (e.defaultPrevented || selection.editingId !== null || isEditableTarget(e.target)) return;
      if (e.altKey) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'a' || e.key === 'A') {
          // Never select the page's text.
          e.preventDefault();
          selection.setMany(allObjectIds(snapshot, isRegisteredType), false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      const selected = snapshot.filter(
        (o) => selection.ids.has(o.id) && isRegisteredType(o.type),
      );
      if (selected.length === 0) return;

      const arrow = ARROWS[e.key];
      if (arrow) {
        // No page scroll and no board pan, even when the board is locked.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        // Positions straight from the doc: key repeat can outpace rendering.
        const current = objectsSnapshot(doc).filter((o) => selection.ids.has(o.id));
        moveObjects(
          doc,
          new Map(current.map((o) => [o.id, { x: o.x + arrow.x * step, y: o.y + arrow.y * step }])),
        );
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) return;
        e.preventDefault();
        deleteObjects(
          doc,
          selected.map((o) => o.id),
        );
        selection.clear();
      } else if (e.key === 'Enter') {
        // Enter on a focused button activates the button instead.
        if (!canEdit || e.target instanceof HTMLButtonElement) return;
        if (selected.length !== 1 || !getObjectType(selected[0].type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(selected[0].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
