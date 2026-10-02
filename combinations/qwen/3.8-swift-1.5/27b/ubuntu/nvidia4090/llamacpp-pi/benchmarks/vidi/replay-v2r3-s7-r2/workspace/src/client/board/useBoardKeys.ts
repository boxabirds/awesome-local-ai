import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { Selection } from './useSelection';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';

/**
 * Board keyboard shortcuts (story 7, sel.keys).
 *
 *  - Ctrl/Cmd+A: select all registered objects (preventDefault).
 *  - Escape: clear the selection (a live marquee consumes Escape first and
 *    cancels itself; see useMarquee).
 *  - Arrows: nudge the selection by NUDGE_STEP_WORLD (Shift: ×10),
 *    preventDefault (no page scroll / board pan).
 *  - Delete/Backspace: delete the selection (one LOCAL_ORIGIN transaction),
 *    then clear it.
 *  - Enter: edit a single selected sticky (story 2).
 *
 * Ignored while `editingId` is set, while focus is in an input/textarea
 * (or contenteditable), or — for the mutating keys — when `canEdit` is false.
 */
export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

export function useBoardKeys(options: BoardKeysOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { selection, snapshot, doc, canEdit } = optsRef.current;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable);
      if (inField || selection.editingId !== null) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      const ids = [...selection.ids];
      if (ids.length === 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!canEdit) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) return;
        e.preventDefault();
        deleteObjects(doc, ids);
        selection.clear();
        return;
      }

      if (e.key === 'Enter' && ids.length === 1) {
        const o = snapshot.find((s) => s.id === ids[0]);
        if (o && getObjectType(o.type)?.editableText) {
          e.preventDefault();
          selection.startEdit(ids[0]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
