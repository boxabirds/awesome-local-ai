// Board keyboard commands (story 7).
//
// Owns every window-level shortcut that acts on the *selection*: Enter edits the
// single selected object, Delete/Backspace deletes the whole selection, the arrow
// keys nudge it, and Cmd/Ctrl+A selects every object. Text editing owns the
// keyboard instead (an in-progress edit leaves these alone) and a board we cannot
// load-lock accepts no edits at all — both bail out before any write.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { SelectionApi } from './useSelection';

export interface BoardKeyOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Begin editing the sole selected object (a single object only). */
  onCreate?: () => void;
}

/** True when focus is in a field that owns the keyboard. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

/** True when the key is an arrow we nudge with. */
function nudgeDelta(
  key: string,
  step: number,
): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Installs the selection keyboard shortcuts. Reads the latest selection / snapshot
 * through a ref so the single window listener is never re-bound.
 */
export function useBoardKeys(opts: BoardKeyOptions): void {
  const live = useRef(opts);
  live.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = live.current;

      // While an editor has focus it owns the keyboard (text fields keep their own
      // Ctrl+A / arrows / Backspace), so nothing here runs.
      if (selection.editingId !== null || isEditable(e.target)) return;
      if (!canEdit) return;

      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+A selects every object (empty board → empty set, no error).
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Escape drops the whole selection.
      if (e.key === 'Escape') {
        if (selection.ids.size > 0) {
          e.preventDefault();
          selection.clear();
        }
        return;
      }

      if (e.key === 'Enter') {
        // Keep story 2's Enter-to-edit for the single selected object.
        if (selection.ids.size === 1) {
          const [id] = [...selection.ids];
          if (id !== undefined) {
            e.preventDefault();
            selection.startEdit(id);
          }
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      const delta = nudgeDelta(e.key, step);
      if (delta && selection.ids.size > 0) {
        e.preventDefault();
        const positions = new Map<string, { x: number; y: number }>();
        for (const id of selection.ids) {
          const obj = snapshot.find((o) => o.id === id);
          if (obj) {
            const b = objectBounds(obj);
            positions.set(id, { x: b.x + delta.dx, y: b.y + delta.dy });
          }
        }
        moveObjects(doc, positions);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
