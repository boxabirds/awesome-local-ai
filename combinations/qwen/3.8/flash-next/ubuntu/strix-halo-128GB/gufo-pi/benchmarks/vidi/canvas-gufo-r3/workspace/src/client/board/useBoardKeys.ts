import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import {
  ObjectSnapshot,
  allObjectIds,
  moveObjects,
  deleteObjects,
  objectBounds,
} from '@shared/board-model';
import { SelectionApi } from './useSelection';

export interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const sel = selectionRef.current;
      const editing = sel.editingId !== null;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !editing) {
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        const ids = allObjectIds(snapshotRef.current);
        sel.setMany(ids, false);
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape' && !editing) {
        sel.clear();
        return;
      }

      // Arrow keys: nudge selection
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowUp') dy = -step;

        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of snapshotRef.current) {
          if (sel.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        if (positions.size > 0) {
          moveObjects(docRef.current, positions);
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (
        sel.ids.size > 0 &&
        !editing &&
        !isTextInputTarget(e.target) &&
        (e.key === 'Delete' || e.key === 'Backspace')
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        deleteObjects(docRef.current, [...sel.ids]);
        sel.clear();
        return;
      }

      // Enter: edit single selected sticky
      if (
        e.key === 'Enter' &&
        !editing &&
        !isTextInputTarget(e.target) &&
        sel.ids.size === 1 &&
        !e.ctrlKey && !e.metaKey
      ) {
        if (!canEditRef.current) return;
        e.preventDefault();
        const id = [...sel.ids][0];
        const obj = snapshotRef.current.find((o) => o.id === id);
        if (obj && obj.type === 'sticky') {
          sel.startEdit(id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
