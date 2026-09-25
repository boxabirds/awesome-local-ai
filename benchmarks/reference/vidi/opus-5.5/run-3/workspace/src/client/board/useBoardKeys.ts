import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
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

export function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/**
 * Board keyboard commands (sel.keyboard): Ctrl/Cmd+A selects everything, Escape clears, arrows nudge
 * (Shift: further), Delete/Backspace delete the selection, Enter edits a single selected note.
 * Ignored while text is being edited or focus is in a text field; changing keys also need `canEdit`.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = latest.current;
      if (selection.editingId !== null || isTextField(e.target) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault(); // never select the page's text
          selection.setMany(allObjectIds(snapshot), false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (selection.ids.size > 0) selection.clear();
        return;
      }
      if (selection.ids.size === 0) return;
      const dir = ARROWS[e.key];
      if (dir) {
        // Arrows move the selection, never the page or the board.
        e.preventDefault();
        if (!canEdit) return;
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dir.x * step, y: o.y + dir.y * step });
        }
        moveObjects(doc, positions);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
      } else if (e.key === 'Enter') {
        if (!canEdit || selection.ids.size !== 1) return;
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        const [id] = selection.ids;
        const obj = snapshot.find((o) => o.id === id);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        // Prevent the default so this Enter is not also typed into the editor that is about to open.
        e.preventDefault();
        selection.startEdit(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
