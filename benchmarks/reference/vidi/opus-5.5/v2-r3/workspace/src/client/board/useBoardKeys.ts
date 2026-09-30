import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Text fields keep every key (typing, caret moves, their own select-all). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isButton(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.tagName === 'BUTTON';
}

/** An object focused with Tab (not necessarily selected) — keys act on it. */
function focusedObjectId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  return target.closest<HTMLElement>('[data-object-id]')?.dataset.objectId;
}

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A select all, Escape clear,
 * arrows nudge, Delete/Backspace delete, Enter edits a single text object.
 * Nothing happens while text is being edited or a text field has focus; the
 * mutating keys also need `canEdit`.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      if (selection.editingId !== null || isEditableTarget(e.target)) return;
      if (e.altKey) return;
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (ctrlOrMeta && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault(); // never select the page's text
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }
      if (ctrlOrMeta) return;

      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
        return;
      }

      const present = new Set(snapshot.map((o) => o.id));
      const focused = focusedObjectId(e.target);
      const ids =
        focused !== undefined && !selection.ids.has(focused) && present.has(focused)
          ? [focused]
          : [...selection.ids].filter((id) => present.has(id));
      if (ids.length === 0 || !canEdit) return;

      const dir = ARROWS[e.key];
      if (dir) {
        e.preventDefault(); // no page scroll, no board pan
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const byId = new Map(snapshot.map((o) => [o.id, o]));
        const positions = new Map<string, Point>();
        for (const id of ids) {
          const o = byId.get(id)!;
          positions.set(id, { x: o.x + dir.x * step, y: o.y + dir.y * step });
        }
        moveObjects(doc, positions);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObjects(doc, ids);
        selection.clear();
        return;
      }
      if (e.key === 'Enter' && !isButton(e.target) && ids.length === 1) {
        const obj = snapshot.find((o) => o.id === ids[0]);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        selection.startEdit(obj.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
