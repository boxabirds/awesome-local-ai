import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
} from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { useSelection } from './useSelection';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Board-level keyboard commands (sel.keyboard): select all, clear, delete, nudge
 * and Enter-to-edit. They never run while editing text — Ctrl+A and the arrow
 * keys keep their normal text behaviour, every other key passes through.
 */
export function useBoardKeys(opts: BoardKeyOptions) {
  const live = useRef(opts);
  live.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const o = live.current;
      // Editing text, or focus in a text field: the board handles nothing.
      if (o.selection.editingId !== null || isTextEntryTarget(e.target)) return;

      const meta = e.ctrlKey || e.metaKey;
      const ids = [...o.selection.ids];

      if (meta && (e.key === 'a' || e.key === 'A')) {
        o.selection.setMany(allObjectIds(o.snapshot), false);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case 'Escape':
          o.selection.clear();
          return;
        case 'Delete':
        case 'Backspace': {
          if (ids.length === 0 || !o.canEdit) return;
          deleteObjects(o.doc, ids);
          e.preventDefault();
          return;
        }
        case 'Enter': {
          if (!o.canEdit || ids.length !== 1) return;
          const obj = o.snapshot.find((s) => s.id === ids[0]);
          const spec = obj ? getObjectType(obj.type) : undefined;
          if (spec?.editableText) {
            o.selection.startEdit(ids[0]);
            e.preventDefault();
          }
          return;
        }
        default:
          break;
      }

      const dir = ARROWS[e.key];
      if (dir && ids.length > 0 && o.canEdit) {
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const id of ids) {
          const obj = o.snapshot.find((s) => s.id === id);
          if (!obj) continue;
          const b = objectBounds(obj);
          positions.set(id, { x: b.x + dir[0] * step, y: b.y + dir[1] * step });
        }
        moveObjects(o.doc, positions);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
