import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /**
   * Give the marquee a chance to consume Escape while it is active (returns
   * true when it did).
   */
  escapeHandler?: () => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'INPUT' ||
    el.isContentEditable
  );
}

/**
 * Global board keyboard commands (story 7, sel.keyboard):
 * - Ctrl/Cmd+A → select all (registered) objects, preventDefault
 * - Escape → clear the selection (while not editing text; the marquee gets
 *   first refusal while active)
 * - Arrows → nudge the selection by NUDGE_STEP_WORLD (Shift: NUDGE_LARGE),
 *   preventDefault (no page scroll)
 * - Delete/Backspace → delete the selection (ignored while editing text,
 *   where Backspace is a normal text edit)
 * - Enter → start editing the single selected sticky (story 2)
 *
 * All commands are ignored while a text editor is focused/open.
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const o = ref.current;
      const { selection, doc, snapshot, canEdit } = o;
      if (isEditableTarget(e.target)) return;
      if (selection.editingId !== null) return;

      // Ctrl/Cmd+A — select all (a second press deselects, design
      // sel.keyboard: "when everything is already selected, deselect").
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const all = allObjectIds(snapshot);
        const allSelected =
          all.length > 0 && all.every((id) => selection.ids.has(id));
        if (allSelected) selection.clear();
        else selection.setMany(all, false);
        return;
      }

      // Escape — clear (marquee may consume it while active).
      if (e.key === 'Escape') {
        if (o.escapeHandler && o.escapeHandler()) return;
        selection.clear();
        return;
      }

      // Arrow keys — nudge the selection (no page scroll).
      const arrow: [number, number] | null =
        e.key === 'ArrowLeft'
          ? [-1, 0]
          : e.key === 'ArrowRight'
            ? [1, 0]
            : e.key === 'ArrowUp'
              ? [0, -1]
              : e.key === 'ArrowDown'
                ? [0, 1]
                : null;
      if (arrow) {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) {
            positions.set(o.id, { x: o.x + arrow[0] * step, y: o.y + arrow[1] * step });
          }
        }
        moveObjects(doc, positions);
        return;
      }

      // Delete / Backspace — delete the selection.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.ids.size === 0) return;
        if (!canEdit) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      // Enter — edit the single selected sticky (story 2).
      if (e.key === 'Enter' && selection.ids.size === 1) {
        const id = [...selection.ids][0];
        const obj = snapshot.find((s) => s.id === id);
        if (obj && getObjectType(obj.type)?.editableText) {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
